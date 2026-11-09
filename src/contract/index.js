/**
 * Public contract exports used by HTTP publish and socket intent handlers.
 */
const {
	PROTOCOL_VERSION,
	MAX_INTENTS,
	EVENT_ALLOWLIST,
	USER_SCOPED_EVENTS,
	USER_ACCESS_CHANGED,
	userIdFromScope
} = require('./names');
const { validateEventEnvelope } = require('./envelope');
const { validateIntentsSet } = require('./intents');
const { validationErrors } = require('./errors');

module.exports = {
	PROTOCOL_VERSION,
	MAX_INTENTS,
	EVENT_ALLOWLIST,
	USER_SCOPED_EVENTS,
	USER_ACCESS_CHANGED,
	userIdFromScope,
	validateIntentsSet,
	validateEventEnvelope,
	validationErrors
};
