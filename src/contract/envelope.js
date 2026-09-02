const { PROTOCOL_VERSION, EVENT_NAMES } = require('./names');
const {
	ISO_TIMESTAMP,
	error,
	isNonEmptyString,
	isPlainObject
} = require('./errors');

/**
 * This function validates a domain-event envelope from Gaia. Collected
 * errors are stored on validateEventEnvelope.errors.
 *
 * @method validateEventEnvelope
 * @param {Object} payload Raw POST /publish body
 * @returns {Boolean} True when the envelope is valid
 * @public
 */
function validateEventEnvelope(payload) {
	const errors = [];
	validateEventEnvelope.errors = errors;

	if (!isPlainObject(payload)) {
		errors.push(error('/', 'type', 'must be object'));
		return false;
	}

	const allowed = [
		'schemaVersion',
		'eventId',
		'eventName',
		'occurredAt',
		'projectId',
		'resource',
		'actorId',
		'changes',
		'meta'
	];
	const extraKeys = Object.keys(payload).filter((key) => !allowed.includes(key));
	if (extraKeys.length) {
		errors.push(error('/', 'additionalProperties', `must NOT have additional properties (${extraKeys.join(', ')})`));
	}
	if (payload.schemaVersion !== PROTOCOL_VERSION) {
		errors.push(error('/schemaVersion', 'const', `must be ${PROTOCOL_VERSION}`));
	}
	if (!isNonEmptyString(payload.eventId, 255)) {
		errors.push(error('/eventId', 'type', 'must be a non-empty string'));
	}
	if (!EVENT_NAMES.has(payload.eventName)) {
		errors.push(error('/eventName', 'enum', 'must be an allowlisted event'));
	}
	if (typeof payload.occurredAt !== 'string' || !ISO_TIMESTAMP.test(payload.occurredAt)) {
		errors.push(error('/occurredAt', 'pattern', 'must be an ISO-8601 timestamp'));
	}
	if (!isNonEmptyString(payload.projectId, 255)) {
		errors.push(error('/projectId', 'type', 'must be a non-empty string'));
	}
	if (!isPlainObject(payload.resource)) {
		errors.push(error('/resource', 'type', 'must be object'));
	} else {
		const extraResource = Object.keys(payload.resource).filter((key) => !['type', 'id'].includes(key));
		if (extraResource.length) {
			errors.push(error('/resource', 'additionalProperties', 'must NOT have additional properties'));
		}
		if (!isNonEmptyString(payload.resource.type, 100)) {
			errors.push(error('/resource/type', 'type', 'must be a non-empty string'));
		}
		if (!isNonEmptyString(payload.resource.id, 255)) {
			errors.push(error('/resource/id', 'type', 'must be a non-empty string'));
		}
	}
	if (!(payload.actorId === null || isNonEmptyString(payload.actorId, 255))) {
		errors.push(error('/actorId', 'type', 'must be a string or null'));
	}
	if (!isPlainObject(payload.changes)) {
		errors.push(error('/changes', 'type', 'must be object'));
	}
	if (payload.meta !== undefined && !isPlainObject(payload.meta)) {
		errors.push(error('/meta', 'type', 'must be object'));
	}

	return errors.length === 0;
}

module.exports = { validateEventEnvelope };
