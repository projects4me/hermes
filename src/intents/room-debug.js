const { ROOM_PREFIX } = require('./rooms');

const MAX_SUBSCRIBER_IDS = 20;

/**
 * This function describes who is currently joined to a composite intent room.
 *
 * @method describeRoomSubscribers
 * @param {Object} io Socket.IO server
 * @param {String} room Composite room key
 * @param {Number} [limit=20] Max socket/user ids to include in lists
 * @returns {{subscribers: Number, subscriberSocketIds: String[], subscriberUserIds: String[]}}
 * @public
 */
function describeRoomSubscribers(io, room, limit = MAX_SUBSCRIBER_IDS) {
	const memberIds = io.sockets.adapter.rooms.get(room);
	if (!memberIds || memberIds.size === 0) {
		return {
			subscribers: 0,
			subscriberSocketIds: [],
			subscriberUserIds: []
		};
	}

	const subscriberSocketIds = [];
	const subscriberUserIds = [];
	const seenUsers = new Set();

	for (const socketId of memberIds) {
		if (subscriberSocketIds.length < limit) {
			subscriberSocketIds.push(socketId);
		}
		const socket = io.sockets.sockets.get(socketId);
		const userId = socket && socket.data ? socket.data.userId : null;
		if (userId != null && userId !== '' && !seenUsers.has(userId)) {
			seenUsers.add(userId);
			if (subscriberUserIds.length < limit) {
				subscriberUserIds.push(String(userId));
			}
		}
	}

	return {
		subscribers: memberIds.size,
		subscriberSocketIds,
		subscriberUserIds
	};
}

/**
 * This function counts distinct non-empty composite intent rooms on the adapter.
 * Socket.IO also stores each socket id as a room; those are ignored.
 *
 * @method countIntentRooms
 * @param {Object} io Socket.IO server
 * @returns {Number}
 * @public
 */
function countIntentRooms(io) {
	let count = 0;
	for (const [name, members] of io.sockets.adapter.rooms) {
		if (name.startsWith(ROOM_PREFIX) && members && members.size > 0) {
			count += 1;
		}
	}
	return count;
}

/**
 * This function returns how many sockets are currently connected.
 *
 * @method connectedSocketCount
 * @param {Object} io Socket.IO server
 * @returns {Number}
 * @public
 */
function connectedSocketCount(io) {
	if (io.engine && typeof io.engine.clientsCount === 'number') {
		return io.engine.clientsCount;
	}
	return io.sockets.sockets.size;
}

/**
 * This function formats a short projectId:eventName label for logs.
 *
 * @method formatIntentLabel
 * @param {{projectId: String, eventName: String}} intent
 * @returns {String}
 * @public
 */
function formatIntentLabel(intent) {
	return `${intent.projectId}:${intent.eventName}`;
}

module.exports = {
	MAX_SUBSCRIBER_IDS,
	describeRoomSubscribers,
	countIntentRooms,
	connectedSocketCount,
	formatIntentLabel
};
