/**
 * How the collab server saves: a failed save is logged and reported, never
 * thrown, and the save before a doc leaves memory is retried (D-022).
 */

/**
 * @class SavePolicy
 * @public
 */
class SavePolicy {
	/**
	 * @param {Object} options
	 * @param {Object} options.store ContentStore
	 * @param {Number[]} options.finalSaveRetryMs Waits before each retry of the final save
	 * @param {Object} [options.logger] console-like logger
	 */
	constructor({ store, finalSaveRetryMs, logger = console }) {
		this.store = store;
		this.finalSaveRetryMs = finalSaveRetryMs;
		this.logger = logger;
	}

	/**
	 * This function saves a doc and reports whether Gaia took it. A failure
	 * is logged with the doc name and the error's own message (a Gaia
	 * status), never tokens or content, and is not thrown: Hocuspocus does
	 * not handle rejections from its save timers.
	 *
	 * @method trySave
	 * @param {String} documentName
	 * @param {Y.Doc} document
	 * @param {Boolean} render Also write html and plainText
	 * @returns {Promise<Boolean>}
	 * @public
	 */
	async trySave(documentName, document, render) {
		try {
			return await this.store.save(documentName, document, { render });
		} catch (error) {
			this.logger.error(`collab: ${documentName} not saved (${error.message})`);
			return false;
		}
	}

	/**
	 * This function makes the save before a doc leaves memory, retrying it
	 * while nobody has reconnected. Hocuspocus unloads the doc afterwards
	 * either way, so edits Gaia never took are reported as dropped.
	 *
	 * @method saveBeforeUnload
	 * @param {String} documentName
	 * @param {Y.Doc} document
	 * @returns {Promise<void>}
	 * @public
	 */
	async saveBeforeUnload(documentName, document) {
		for (const waitMs of [0, ...this.finalSaveRetryMs]) {
			if (waitMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
			if (await this.trySave(documentName, document, true)) {
				return;
			}
			if (document.getConnectionsCount() > 0) {
				return;
			}
		}
		this.logger.error(`collab: ${documentName} unloaded with edits Gaia did not take`);
	}
}

module.exports = { SavePolicy };
