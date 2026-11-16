/**
 * The messages the collab server sends to clients outside the Yjs sync:
 * stateless JSON messages and the close codes it uses. This is the contract
 * with Prometheus, documented in collab/README.md.
 */

/** Close code for a connection the server ends for good: the client must not reconnect on its own. */
const UNAUTHORIZED_CODE = 4401;

/** Close events, frozen so no caller changes the contract by accident. */
const CLOSE_EVENTS = Object.freeze({
	docDeleted: Object.freeze({ code: UNAUTHORIZED_CODE, reason: 'doc deleted' }),
	accessLost: Object.freeze({ code: UNAUTHORIZED_CODE, reason: 'access lost' }),
	updateTooLarge: Object.freeze({ code: 1009, reason: 'update too large' }),
	tooManyUpdates: Object.freeze({ code: 4429, reason: 'too many updates' })
});

/**
 * This function returns the message telling a client whether it may edit.
 *
 * @method accessMessage
 * @param {Boolean} readOnly
 * @param {String} reason Why Gaia asked for the re-check: locked, unlocked, deleted or access
 * @returns {String} JSON
 * @public
 */
function accessMessage(readOnly, reason) {
	return JSON.stringify({ type: 'access', readOnly, reason });
}

/**
 * @method deletedMessage
 * @returns {String} JSON
 * @public
 */
function deletedMessage() {
	return JSON.stringify({ type: 'deleted' });
}

/**
 * This function returns the message telling clients that Gaia has not taken
 * the doc's changes since the given time.
 *
 * @method unsavedMessage
 * @param {Date} since First failed save
 * @returns {String} JSON
 * @public
 */
function unsavedMessage(since) {
	return JSON.stringify({ type: 'unsaved', since: since.toISOString() });
}

/**
 * @method savedMessage
 * @returns {String} JSON
 * @public
 */
function savedMessage() {
	return JSON.stringify({ type: 'saved' });
}

module.exports = { CLOSE_EVENTS, accessMessage, deletedMessage, unsavedMessage, savedMessage };
