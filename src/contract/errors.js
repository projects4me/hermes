/**
 * ISO-8601 timestamp pattern required on envelope.occurredAt.
 *
 * @property ISO_TIMESTAMP
 * @type RegExp
 * @public
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * This function builds a JSON-schema-like validation error object.
 *
 * @method error
 * @param {String} path JSON pointer path
 * @param {String} keyword Validation keyword
 * @param {String} message Human-readable message
 * @returns {{path: String, keyword: String, message: String}}
 * @public
 */
function error(path, keyword, message) {
	return { path, keyword, message };
}

/**
 * This function returns true when value is a non-empty string within maxLength.
 *
 * @method isNonEmptyString
 * @param {*} value Value to test
 * @param {Number} maxLength Maximum allowed length
 * @returns {Boolean}
 * @public
 */
function isNonEmptyString(value, maxLength) {
	return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * This function returns true when value is a non-array object.
 *
 * @method isPlainObject
 * @param {*} value Value to test
 * @returns {Boolean}
 * @public
 */
function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * This function maps a validator's collected errors into the public shape.
 *
 * @method validationErrors
 * @param {Function} validate Validator that stores errors on itself
 * @returns {Array<{path: String, keyword: String, message: String}>}
 * @public
 */
function validationErrors(validate) {
	return (validate.errors || []).map(({ path, keyword, message }) => ({
		path: path || '/',
		keyword,
		message
	}));
}

module.exports = {
	ISO_TIMESTAMP,
	error,
	isNonEmptyString,
	isPlainObject,
	validationErrors
};
