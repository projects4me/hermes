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
	'user.access.changed',
	'user.mentioned',
	'workflow.run.finished',
	'search.semantic.changed'
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
	'user.access.changed',
	'user.mentioned'
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
 * The service kind whose service tokens may open a runtimes socket (D-020).
 *
 * @property RUNTIME_SERVICE_KIND
 * @type String
 * @public
 */
const RUNTIME_SERVICE_KIND = 'runtime';

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
 * Prefix of a service scope projectId (`service:<serviceKind>`, D-024).
 *
 * @property SERVICE_SCOPE_PREFIX
 * @type String
 * @public
 */
const SERVICE_SCOPE_PREFIX = 'service:';

/**
 * Service-scoped events by service kind: Gaia publishes them to
 * `service:<serviceKind>` and only a service token of that kind may subscribe
 * to them there (D-024). They are the only events such a socket may take.
 *
 * @property SERVICE_SCOPED_EVENTS
 * @type Map<String, Set<String>>
 * @public
 */
const SERVICE_SCOPED_EVENTS = new Map([
	['ares', new Set(['search.semantic.changed'])]
]);

/**
 * This function returns the service kind from a service scope
 * (`service:<serviceKind>`, D-024), or null when the projectId is not a
 * service scope or names no kind.
 *
 * @method serviceKindFromScope
 * @param {String} projectId Envelope or intent projectId
 * @returns {String|null}
 * @public
 */
function serviceKindFromScope(projectId) {
	if (typeof projectId !== 'string' || !projectId.startsWith(SERVICE_SCOPE_PREFIX)) {
		return null;
	}
	return projectId.slice(SERVICE_SCOPE_PREFIX.length) || null;
}

/**
 * This function tells whether an event is service-scoped for any kind.
 *
 * @method isServiceScopedEvent
 * @param {String} eventName Event name
 * @returns {Boolean}
 * @public
 */
function isServiceScopedEvent(eventName) {
	for (const events of SERVICE_SCOPED_EVENTS.values()) {
		if (events.has(eventName)) {
			return true;
		}
	}
	return false;
}

/**
 * This function tells whether an event may ride on a service scope: the
 * scope names a known service kind and the event is one of that kind's
 * service-scoped events.
 *
 * @method isAllowedOnServiceScope
 * @param {String} projectId Envelope or intent projectId
 * @param {String} eventName Event name
 * @returns {Boolean}
 * @public
 */
function isAllowedOnServiceScope(projectId, eventName) {
	const events = SERVICE_SCOPED_EVENTS.get(serviceKindFromScope(projectId));
	return Boolean(events) && events.has(eventName);
}

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
	RUNTIME_SERVICE_KIND,
	SERVICE_SCOPE_PREFIX,
	SERVICE_SCOPED_EVENTS,
	serviceKindFromScope,
	isServiceScopedEvent,
	isAllowedOnServiceScope,
	USER_ACCESS_CHANGED,
	USER_SCOPE_PREFIX,
	userIdFromScope,
	EVENT_NAMES
};
