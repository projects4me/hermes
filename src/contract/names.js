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
	'notification.created'
]);

/**
 * Events that are user-scoped. Their projectId must be 'user:<userId>' rather
 * than a project id from the member list.
 *
 * @property USER_SCOPED_EVENTS
 * @type Set<String>
 * @public
 */
const USER_SCOPED_EVENTS = new Set(['notification.created']);

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
	EVENT_NAMES
};
