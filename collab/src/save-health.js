/**
 * Tells a doc's clients when saving to Gaia has been failing for too long,
 * and again once a save goes through.
 */
const { unsavedMessage, savedMessage } = require('./client-messages');

/**
 * @class SaveHealth
 * @public
 */
class SaveHealth {
	/**
	 * @param {Object} options
	 * @param {Number} options.unsavedAfterMs How long saves must fail before clients are told
	 * @param {Function} options.notify function(documentName, message) sending a JSON message to the doc's clients
	 */
	constructor({ unsavedAfterMs, notify }) {
		this.unsavedAfterMs = unsavedAfterMs;
		this.notify = notify;
		this.docs = new Map();
	}

	/**
	 * This function records a failed save. The first failure of a run starts
	 * the clock; the clients are told once it has run for `unsavedAfterMs`.
	 *
	 * @method failed
	 * @param {String} documentName
	 * @public
	 */
	failed(documentName) {
		if (this.docs.has(documentName)) {
			return;
		}
		const entry = { since: new Date(), announced: false, timer: null };
		entry.timer = setTimeout(() => {
			entry.announced = true;
			this.notify(documentName, unsavedMessage(entry.since));
		}, this.unsavedAfterMs);
		entry.timer.unref?.();
		this.docs.set(documentName, entry);
	}

	/**
	 * This function records a save Gaia took, and tells the clients when they
	 * had been told the doc was unsaved.
	 *
	 * @method saved
	 * @param {String} documentName
	 * @public
	 */
	saved(documentName) {
		const entry = this.docs.get(documentName);
		if (!entry) {
			return;
		}
		this.forget(documentName);
		if (entry.announced) {
			this.notify(documentName, savedMessage());
		}
	}

	/**
	 * This function returns the message for a client joining a doc whose
	 * clients were told it is unsaved.
	 *
	 * @method pendingMessage
	 * @param {String} documentName
	 * @returns {String|null} JSON, or null when nothing was announced
	 * @public
	 */
	pendingMessage(documentName) {
		const entry = this.docs.get(documentName);
		return entry?.announced ? unsavedMessage(entry.since) : null;
	}

	/**
	 * @method forget
	 * @param {String} documentName
	 * @public
	 */
	forget(documentName) {
		clearTimeout(this.docs.get(documentName)?.timer);
		this.docs.delete(documentName);
	}
}

module.exports = { SaveHealth };
