/**
 * Protocol version required on envelopes and intents:set.
 *
 * @property PROTOCOL_VERSION
 * @type Number
 * @public
 */
const PROTOCOL_VERSION = 1;

/**
 * Maximum number of intents accepted in one intents:set snapshot.
 *
 * @property MAX_INTENTS
 * @type Number
 * @public
 */
const MAX_INTENTS = 100;

/**
 * Allowlisted domain-event names. Keep in lockstep with Gaia EventNames.
 *
 * @property EVENT_ALLOWLIST
 * @type Array<String>
 * @public
 */
const EVENT_ALLOWLIST = Object.freeze([
	'issue.status.changed',
	'issue.assignee.changed',
	'milestone.created',
	'milestone.completed',
	'issue.created',
	'issue.dates.changed',
	'issue.dependency.created',
	'issue.dependency.deleted',
	'conversation.comment.created',
	'conversation.comment.updated',
	'conversation.comment.deleted',
	'conversation.vote.added',
	'conversation.vote.removed',
	'conversation.created',
	'notification.created',
	'idea.created',
	'idea.updated',
	'idea.message.created',
	'idea.plan.created',
	'idea.plan.status.changed',
	'idea.planissue.created',
	'doc.created',
	'doc.updated',
	'doc.deleted',
	'workflow.agent.run.requested',
	'user.access.changed'
]);

/**
 * Events that are user-scoped. Their projectId must be 'user:<userId>' rather
 * than a project id from the member list.
 *
 * @property USER_SCOPED_EVENTS
 * @type Set<String>
 * @public
 */
const USER_SCOPED_EVENTS = new Set([
	'notification.created',
	'workflow.agent.run.requested',
	'user.access.changed'
]);

/**
 * The runtimes scope: the projectId Gaia publishes to so that every Talos
 * runtime (a service token of kind runtime) can take the event on one socket.
 *
 * @property RUNTIMES_SCOPE
 * @type String
 * @public
 */
const RUNTIMES_SCOPE = 'runtimes';

/**
 * Events that may be published to, and subscribed on, the runtimes scope.
 * They are the only events a runtime socket may subscribe to.
 *
 * @property RUNTIME_SCOPED_EVENTS
 * @type Set<String>
 * @public
 */
const RUNTIME_SCOPED_EVENTS = new Set([
	'workflow.agent.run.requested'
]);

/**
 * User-scoped event Gaia publishes when a user's access changes (account
 * status, session revocation, membership create or delete). Hermes re-checks
 * that user's sockets when it arrives (D-021).
 *
 * @property USER_ACCESS_CHANGED
 * @type String
 * @public
 */
const USER_ACCESS_CHANGED = 'user.access.changed';

/**
 * Prefix of a user scope projectId (`user:<userId>`, D-009).
 *
 * @property USER_SCOPE_PREFIX
 * @type String
 * @public
 */
const USER_SCOPE_PREFIX = 'user:';

/**
 * This function returns the user id from a user scope (`user:<userId>`,
 * D-009), or null when the projectId is not a user scope.
 *
 * @method userIdFromScope
 * @param {String} projectId Envelope projectId
 * @returns {String|null}
 * @public
 */
function userIdFromScope(projectId) {
	if (typeof projectId !== 'string' || !projectId.startsWith(USER_SCOPE_PREFIX)) {
		return null;
	}
	const userId = projectId.slice(USER_SCOPE_PREFIX.length);
	return userId || null;
}

/**
 * Set form of EVENT_ALLOWLIST for O(1) lookups.
 *
 * @property EVENT_NAMES
 * @type Set<String>
 * @public
 */
const EVENT_NAMES = new Set(EVENT_ALLOWLIST);

module.exports = {
	PROTOCOL_VERSION,
	MAX_INTENTS,
	EVENT_ALLOWLIST,
	USER_SCOPED_EVENTS,
	RUNTIMES_SCOPE,
	RUNTIME_SCOPED_EVENTS,
	USER_ACCESS_CHANGED,
	USER_SCOPE_PREFIX,
	userIdFromScope,
	EVENT_NAMES
};
