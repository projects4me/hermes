const { validateEventEnvelope, validationErrors } = require('../../contract');
const { compositeRoom } = require('../../intents/rooms');
const {
	describeRoomSubscribers,
	countIntentRooms,
	connectedSocketCount
} = require('../../intents/room-debug');

/**
 * This function returns the Express handler for POST /publish. Valid
 * envelopes are emitted as domain:event on the matching composite room.
 *
 * @method createPublishHandler
 * @param {Object} deps
 * @param {Object} deps.io Socket.IO server
 * @param {Object} deps.counters In-memory counters
 * @param {Object} deps.logger Logger with optional info()/warn()/error()
 * @returns {Function} Express request handler
 * @public
 */
function createPublishHandler({ io, counters, logger }) {
	return (req, res) => {
		if (!validateEventEnvelope(req.body)) {
			counters.publish.rejected += 1;
			const details = validationErrors(validateEventEnvelope);
			if (typeof logger.warn === 'function') {
				logger.warn('publish rejected invalid_event', {
					details,
					eventName: req.body && req.body.eventName,
					projectId: req.body && req.body.projectId,
					eventId: req.body && req.body.eventId
				});
			}
			return res.status(400).json({
				error: 'invalid_event',
				details
			});
		}

		const room = compositeRoom(req.body.projectId, req.body.eventName);
		const roomInfo = describeRoomSubscribers(io, room);
		const connectedSockets = connectedSocketCount(io);
		const intentRooms = countIntentRooms(io);
		const resource = req.body.resource || {};
		const logFields = {
			eventId: req.body.eventId,
			eventName: req.body.eventName,
			projectId: req.body.projectId,
			actorId: req.body.actorId,
			resource: `${resource.type || '?'}/${resource.id || '?'}`,
			room,
			subscribers: roomInfo.subscribers,
			subscriberUserIds: roomInfo.subscriberUserIds,
			subscriberSocketIds: roomInfo.subscriberSocketIds,
			connectedSockets,
			intentRooms
		};

		io.to(room).emit('domain:event', req.body);
		counters.publish.accepted += 1;
		counters.publish.emitted += 1;

		if (roomInfo.subscribers === 0) {
			counters.publish.zeroSubscribers += 1;
			if (typeof logger.warn === 'function') {
				logger.warn(
					`published with zero subscribers ${req.body.eventName} -> ${room}`,
					logFields
				);
			} else if (typeof logger.info === 'function') {
				logger.info(
					`published with zero subscribers ${req.body.eventName} -> ${room}`,
					logFields
				);
			}
		} else if (typeof logger.info === 'function') {
			logger.info(
				`published ${req.body.eventName} -> ${room}`,
				logFields
			);
		}

		return res.json({
			ok: true,
			eventId: req.body.eventId,
			room,
			subscribers: roomInfo.subscribers
		});
	};
}

module.exports = { createPublishHandler };
