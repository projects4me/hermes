const ROOM_PREFIX = 'v1:intent:';

/**
 * This function builds the internal composite room key for a project/event pair.
 * Room names are not part of the client contract.
 *
 * @method compositeRoom
 * @param {String} projectId Project id or user:<userId>
 * @param {String} eventName Allowlisted event name
 * @returns {String}
 * @public
 */
function compositeRoom(projectId, eventName) {
	return `${ROOM_PREFIX}${encodeURIComponent(projectId)}:${eventName}`;
}

module.exports = { ROOM_PREFIX, compositeRoom };
