const { extractSocketToken } = require('../../auth/tokens');
const { acceptsSocketSession } = require('../../auth/socket-session-policy');

/**
 * This function returns Socket.IO middleware that authenticates the handshake
 * through Gaia introspection (with a session cache), accepts only user and
 * agent actors whose token has not expired, and stores the actor and its
 * project ids and token expiry on the socket.
 *
 * @method createAuthenticate
 * @param {Object} deps
 * @param {Object} deps.sessionCache SessionCache instance
 * @param {Function} deps.loadSession Gaia session loader
 * @param {Object} deps.counters In-memory counters
 * @param {Object} deps.logger Logger with error()
 * @param {Function} [deps.now] Clock in ms
 * @returns {Function} Async Socket.IO middleware
 * @public
 */
function createAuthenticate({ sessionCache, loadSession, counters, logger, now = Date.now }) {
	return async (socket, next) => {
		try {
			const credentials = extractSocketToken(socket.handshake);
			if (!credentials) {
				counters.auth.rejected += 1;
				return next(new Error('unauthorized'));
			}

			let session = sessionCache.get(credentials.token);
			if (session) {
				counters.auth.cacheHits += 1;
			} else {
				counters.auth.cacheMisses += 1;
				session = await loadSession(credentials.token);
				if (session) {
					sessionCache.set(credentials.token, session);
				}
			}
			if (!acceptsSocketSession(session, now())) {
				counters.auth.rejected += 1;
				return next(new Error('unauthorized'));
			}

			socket.data.userId = session.userId;
			socket.data.actorType = session.actorType;
			socket.data.projectIds = (session.projectIds || []).map(String);
			socket.data.expiresAt = session.expiresAt;
			socket.data.authSource = credentials.source;
			counters.auth.accepted += 1;
			return next();
		} catch (error) {
			counters.auth.rejected += 1;
			logger.error('socket auth failed', error.message);
			return next(new Error('unauthorized'));
		}
	};
}

module.exports = { createAuthenticate };
