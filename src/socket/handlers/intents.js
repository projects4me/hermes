const { evaluateIntentSet } = require('../../intents/evaluate');
const { replaceIntentRooms } = require('../../intents/replace');
const { formatIntentLabel } = require('../../intents/room-debug');

/**
 * This function returns rooms present in next but not previous.
 *
 * @method roomDiff
 * @param {Set<String>} previousRooms
 * @param {Set<String>} nextRooms
 * @returns {String[]}
 * @private
 */
function roomDiff(previousRooms, nextRooms) {
	return [...nextRooms].filter((room) => !previousRooms.has(room));
}

/**
 * This function attaches intents:set handling. Intent state belongs to the
 * connection: a reconnect starts with no rooms and revision -1.
 *
 * @method registerIntentHandlers
 * @param {Object} io Socket.IO server
 * @param {Object} deps
 * @param {Object} deps.counters In-memory counters
 * @param {Object} deps.logger Logger with info/warn/error
 * @returns {void}
 * @public
 */
function registerIntentHandlers(io, { counters, logger }) {
	io.on('connection', (socket) => {
		// State belongs to this connection. A reconnect receives a new socket and
		// intentionally starts with no subscriptions and revision -1.
		socket.data.intentState = { revision: -1, rooms: new Set() };
		socket.data.intentQueue = Promise.resolve();

		const projectCount = Array.isArray(socket.data.projectIds)
			? socket.data.projectIds.length
			: 0;
		if (typeof logger.info === 'function') {
			logger.info(
				`connected userId=${socket.data.userId} socket=${socket.id} projects=${projectCount}`
			);
		}

		socket.on('disconnect', (reason) => {
			const roomsWere = socket.data.intentState
				? socket.data.intentState.rooms.size
				: 0;
			if (typeof logger.info === 'function') {
				logger.info(
					`disconnected userId=${socket.data.userId} socket=${socket.id} roomsWere=${roomsWere} reason=${reason}`
				);
			}
		});

		/**
		 * This function evaluates one snapshot and replaces rooms. Callers
		 * serialize it on socket.data.intentQueue.
		 *
		 * @method processIntentSet
		 * @param {Object} payload intents:set body
		 * @param {Function} acknowledge Socket.IO ack callback
		 * @returns {Promise<*>}
		 * @private
		 */
		async function processIntentSet(payload, acknowledge) {
			const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
			const identity = {
				userId: socket.data.userId,
				socketId: socket.id,
				revision: payload && payload.revision
			};
			const previousRooms = socket.data.intentState.rooms;
			const result = evaluateIntentSet(
				payload,
				socket.data.intentState,
				socket.data.projectIds,
				socket.data.userId
			);
			if (!result.ok) {
				counters.intents.setsRejected += 1;
				counters.intents.rejected += result.ack.rejected.length;
				if (result.stale) {
					counters.intents.staleRevisions += 1;
				}
				if (typeof logger.warn === 'function') {
					logger.warn('intents rejected', {
						...identity,
						stale: Boolean(result.stale),
						rejected: result.ack.rejected
					});
				}
				return ack(result.ack);
			}

			try {
				await replaceIntentRooms(
					socket,
					previousRooms,
					result.nextState.rooms
				);
				const joined = roomDiff(previousRooms, result.nextState.rooms);
				const left = roomDiff(result.nextState.rooms, previousRooms);
				socket.data.intentState = result.nextState;
				counters.intents.setsAccepted += 1;
				counters.intents.accepted += result.ack.accepted.length;
				counters.intents.rejected += result.ack.rejected.length;
				if (typeof logger.info === 'function') {
					logger.info(
						`intents accepted revision=${payload.revision} count=${result.ack.accepted.length}`,
						{
							...identity,
							accepted: result.ack.accepted.map(formatIntentLabel),
							rejected: result.ack.rejected,
							roomsJoined: joined,
							roomsLeft: left,
							roomCount: result.nextState.rooms.size
						}
					);
				}
				return ack(result.ack);
			} catch (error) {
				counters.intents.setsRejected += 1;
				counters.intents.rejected += 1;
				logger.error('intent room replacement failed', error.message);
				if (typeof logger.warn === 'function') {
					logger.warn('intents room_update_failed', {
						...identity,
						error: error.message
					});
				}
				return ack({
					revision: payload.revision,
					accepted: [],
					rejected: [{ reason: 'room_update_failed' }]
				});
			}
		}

		socket.on('intents:set', (payload, acknowledge) => {
			// Serialize replacements so two rapid revisions cannot both validate
			// against the same prior state and finish out of order.
			socket.data.intentQueue = socket.data.intentQueue.then(
				() => processIntentSet(payload, acknowledge)
			);
		});
	});
}

module.exports = { registerIntentHandlers };
