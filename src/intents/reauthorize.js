const { isIntentAuthorized } = require('./evaluate');
const { compositeRoom } = require('./rooms');

/**
 * This function re-applies a socket's accepted intents against its current
 * access: intents whose project is no longer authorized are dropped. The
 * revision is kept, so the client's next intents:set still applies. Room
 * membership is not changed here.
 *
 * @method reauthorizeIntentState
 * @param {Object} state Current { revision, rooms, intents } for the socket
 * @param {Array<String>} authorizedProjectIds Project ids from the fresh Gaia session
 * @param {String} socketUserId Authenticated user id
 * @returns {{nextState: Object, dropped: Array<Object>}}
 * @public
 */
function reauthorizeIntentState(state, authorizedProjectIds, socketUserId) {
	const projectIds = new Set((authorizedProjectIds || []).map(String));
	const kept = [];
	const dropped = [];
	for (const intent of state.intents || []) {
		if (isIntentAuthorized(intent, projectIds, socketUserId)) {
			kept.push(intent);
		} else {
			dropped.push(intent);
		}
	}
	return {
		nextState: {
			revision: state.revision,
			rooms: new Set(kept.map((intent) => compositeRoom(intent.projectId, intent.eventName))),
			intents: kept
		},
		dropped
	};
}

module.exports = { reauthorizeIntentState };
