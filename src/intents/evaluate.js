const {
	validateIntentsSet,
	validationErrors,
	USER_SCOPED_EVENTS
} = require('../contract');
const { compositeRoom } = require('./rooms');

/**
 * This function copies projectId/eventName off a raw intent.
 *
 * @method normalizeIntent
 * @param {Object} intent Raw intent
 * @returns {{projectId: String, eventName: String}}
 * @private
 */
function normalizeIntent(intent) {
	return {
		projectId: String(intent.projectId),
		eventName: intent.eventName
	};
}

/**
 * Authorize one intent against the socket's session.
 *
 * User-scoped events (e.g. notification.created) require projectId === 'user:<socketUserId>'.
 * All other events require projectId to be in authorizedProjectIds.
 *
 * @method isIntentAuthorized
 * @param {Object} intent { projectId, eventName }
 * @param {Set} projectIds Set of String project ids the socket may access
 * @param {String} socketUserId The authenticated user id for this socket
 * @returns {Boolean}
 * @public
 */
function isIntentAuthorized(intent, projectIds, socketUserId) {
	if (USER_SCOPED_EVENTS.has(intent.eventName)) {
		return intent.projectId === `user:${socketUserId}`;
	}
	return projectIds.has(intent.projectId);
}

/**
 * This function validates, authorizes, and deduplicates an intents:set
 * snapshot. Room membership is not changed here.
 *
 * @method evaluateIntentSet
 * @param {Object} payload intents:set body
 * @param {Object} state Current { revision, rooms } for the socket
 * @param {Array<String>} authorizedProjectIds Project ids from the Gaia session
 * @param {String} socketUserId Authenticated user id
 * @returns {Object} { ok, stale, nextState?, ack }
 * @public
 */
function evaluateIntentSet(payload, state, authorizedProjectIds, socketUserId) {
	if (!validateIntentsSet(payload)) {
		return {
			ok: false,
			stale: false,
			ack: {
				revision: Number.isInteger(payload?.revision) ? payload.revision : null,
				accepted: [],
				rejected: [{
					reason: 'invalid_payload',
					errors: validationErrors(validateIntentsSet)
				}]
			}
		};
	}

	if (payload.revision <= state.revision) {
		return {
			ok: false,
			stale: true,
			ack: {
				revision: payload.revision,
				accepted: [],
				rejected: [{ reason: 'stale_revision' }]
			}
		};
	}

	const projectIds = new Set((authorizedProjectIds || []).map(String));
	const accepted = [];
	const rejected = [];
	const seenRooms = new Set();

	for (const rawIntent of payload.intents) {
		const intent = normalizeIntent(rawIntent);
		if (!isIntentAuthorized(intent, projectIds, socketUserId)) {
			rejected.push({ ...intent, reason: 'project_not_authorized' });
			continue;
		}

		const room = compositeRoom(intent.projectId, intent.eventName);
		if (seenRooms.has(room)) {
			rejected.push({ ...intent, reason: 'duplicate_intent' });
			continue;
		}
		seenRooms.add(room);
		accepted.push(intent);
	}

	return {
		ok: true,
		stale: false,
		nextState: {
			revision: payload.revision,
			rooms: seenRooms
		},
		ack: {
			revision: payload.revision,
			accepted,
			rejected
		}
	};
}

module.exports = { evaluateIntentSet, isIntentAuthorized };
