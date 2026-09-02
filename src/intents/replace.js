/**
 * This function joins the new composite rooms then leaves the obsolete ones
 * so there is no subscription gap.
 *
 * @method replaceIntentRooms
 * @param {Object} socket Socket.IO socket
 * @param {Set<String>} previousRooms Rooms currently joined
 * @param {Set<String>} nextRooms Rooms from the accepted snapshot
 * @returns {Promise<void>}
 * @public
 */
async function replaceIntentRooms(socket, previousRooms, nextRooms) {
	const toJoin = [...nextRooms].filter((room) => !previousRooms.has(room));
	const toLeave = [...previousRooms].filter((room) => !nextRooms.has(room));

	// Validate first, join the replacement set, then remove obsolete rooms. This
	// avoids a subscription gap and never exposes a partially validated set.
	await Promise.all(toJoin.map((room) => socket.join(room)));
	await Promise.all(toLeave.map((room) => socket.leave(room)));
}

module.exports = { replaceIntentRooms };
