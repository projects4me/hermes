const { extractSocketToken } = require('../auth/tokens');
const { acceptsSocketSession } = require('../auth/socket-session-policy');
const { reauthorizeIntentState } = require('../intents/reauthorize');
const { replaceIntentRooms } = require('../intents/replace');

/**
 * This function returns the re-check Hermes runs when Gaia says a user's
 * access changed (`user.access.changed`, D-020). It evicts the user's cached
 * sessions, then introspects each of the user's sockets again: a socket
 * whose token is no longer accepted is disconnected, and any other socket
 * gets its new project ids and leaves the rooms of intents it is no longer
 * authorized for. A socket whose re-check fails (Gaia unreachable) is
 * disconnected too: its access is unknown, and its next handshake asks Gaia.
 * Each socket's re-check is queued behind its intents:set processing.
 *
 * @method createAccessRecheck
 * @param {Object} deps
 * @param {Object} deps.io Socket.IO server
 * @param {Object} deps.sessionCache SessionCache instance
 * @param {Function} deps.loadSession Gaia session loader
 * @param {Object} deps.counters In-memory counters
 * @param {Object} deps.logger Logger with info/warn
 * @param {Function} [deps.now] Clock in ms
 * @returns {Function} async function(userId) → void
 * @public
 */
function createAccessRecheck({ io, sessionCache, loadSession, counters, logger, now = Date.now }) {
	/**
	 * This function counts and logs a re-check that could not complete.
	 *
	 * @method recordFailure
	 * @param {Object} socket Socket.IO socket
	 * @param {Error} error The failure
	 * @returns {void}
	 * @private
	 */
	function recordFailure(socket, error) {
		counters.access.failures += 1;
		if (typeof logger.warn === 'function') {
			logger.warn('access re-check failed', { userId: socket.data.userId, socketId: socket.id, error: error.message });
		}
	}

	/**
	 * This function disconnects a socket whose access is gone or unknown.
	 *
	 * @method revoke
	 * @param {Object} socket Socket.IO socket
	 * @param {String} reason Short reason for the log
	 * @returns {void}
	 * @private
	 */
	function revoke(socket, reason) {
		counters.access.socketsDisconnected += 1;
		if (typeof logger.info === 'function') {
			logger.info(`access re-check disconnects userId=${socket.data.userId} socket=${socket.id} reason=${reason}`);
		}
		socket.disconnect(true);
	}

	/**
	 * This function re-checks one socket against a fresh introspection.
	 *
	 * @method recheckSocket
	 * @param {Object} socket Socket.IO socket
	 * @returns {Promise<void>}
	 * @private
	 */
	async function recheckSocket(socket) {
		if (!socket.connected) {
			return;
		}
		const credentials = extractSocketToken(socket.handshake);
		let session = null;
		try {
			session = credentials ? await loadSession(credentials.token) : null;
		} catch (error) {
			recordFailure(socket, error);
			if (socket.connected) {
				revoke(socket, 'recheck_failed');
			}
			return;
		}
		if (!socket.connected) {
			return;
		}
		if (!acceptsSocketSession(session, now()) || session.userId !== socket.data.userId) {
			revoke(socket, 'access_revoked');
			return;
		}

		sessionCache.set(credentials.token, session);
		socket.data.projectIds = (session.projectIds || []).map(String);
		socket.data.expiresAt = session.expiresAt;
		const previous = socket.data.intentState;
		const { nextState, dropped } = reauthorizeIntentState(previous, socket.data.projectIds, socket.data.userId);
		await replaceIntentRooms(socket, previous.rooms, nextState.rooms);
		socket.data.intentState = nextState;
		counters.access.socketsRechecked += 1;
		counters.access.intentsDropped += dropped.length;
		if (typeof logger.info === 'function') {
			logger.info(`access re-checked userId=${socket.data.userId} socket=${socket.id} projects=${socket.data.projectIds.length} intentsDropped=${dropped.length}`);
		}
	}

	/**
	 * This function queues a socket's re-check behind its intents:set work, so
	 * a snapshot is never evaluated against half-updated access.
	 *
	 * @method queueRecheck
	 * @param {Object} socket Socket.IO socket
	 * @returns {Promise<void>}
	 * @private
	 */
	function queueRecheck(socket) {
		const queued = (socket.data.intentQueue || Promise.resolve())
			.then(() => recheckSocket(socket))
			.catch((error) => recordFailure(socket, error));
		socket.data.intentQueue = queued;
		return queued;
	}

	return async function recheckUserAccess(userId) {
		counters.access.events += 1;
		sessionCache.evictUser(userId);
		const sockets = [...io.of('/').sockets.values()].filter((socket) => socket.data.userId === userId);
		await Promise.all(sockets.map(queueRecheck));
	};
}

module.exports = { createAccessRecheck };
