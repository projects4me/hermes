const { PROTOCOL_VERSION, MAX_INTENTS, EVENT_NAMES } = require('./names');
const { error, isNonEmptyString, isPlainObject } = require('./errors');

/**
 * This function validates an intents:set payload. Collected errors are stored
 * on validateIntentsSet.errors.
 *
 * @method validateIntentsSet
 * @param {Object} payload Socket intents:set body
 * @returns {Boolean} True when the payload is valid
 * @public
 */
function validateIntentsSet(payload) {
	const errors = [];
	validateIntentsSet.errors = errors;

	if (!isPlainObject(payload)) {
		errors.push(error('/', 'type', 'must be object'));
		return false;
	}

	const extraKeys = Object.keys(payload).filter((key) => !['protocolVersion', 'revision', 'intents'].includes(key));
	if (extraKeys.length) {
		errors.push(error('/', 'additionalProperties', `must NOT have additional properties (${extraKeys.join(', ')})`));
	}
	if (payload.protocolVersion !== PROTOCOL_VERSION) {
		errors.push(error('/protocolVersion', 'const', `must be ${PROTOCOL_VERSION}`));
	}
	if (!Number.isInteger(payload.revision) || payload.revision < 0) {
		errors.push(error('/revision', 'type', 'must be a nonnegative integer'));
	}
	if (!Array.isArray(payload.intents)) {
		errors.push(error('/intents', 'type', 'must be array'));
		return errors.length === 0;
	}
	if (payload.intents.length > MAX_INTENTS) {
		errors.push(error('/intents', 'maxItems', `must NOT have more than ${MAX_INTENTS} items`));
	}

	payload.intents.forEach((intent, index) => {
		if (!isPlainObject(intent)) {
			errors.push(error(`/intents/${index}`, 'type', 'must be object'));
			return;
		}
		const extra = Object.keys(intent).filter((key) => !['projectId', 'eventName'].includes(key));
		if (extra.length) {
			errors.push(error(`/intents/${index}`, 'additionalProperties', 'must NOT have additional properties'));
		}
		if (!isNonEmptyString(intent.projectId, 255)) {
			errors.push(error(`/intents/${index}/projectId`, 'type', 'must be a non-empty string'));
		}
		if (!EVENT_NAMES.has(intent.eventName)) {
			errors.push(error(`/intents/${index}/eventName`, 'enum', 'must be an allowlisted event'));
		}
	});

	return errors.length === 0;
}

module.exports = { validateIntentsSet };
