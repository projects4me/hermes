/**
 * How the collab server saves: a failed save is logged and reported, never
 * thrown, and retried with back-off while the doc is loaded; the save before
 * a doc leaves memory is retried too (D-022).
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
	 * @param {Object} options.retry SaveRetry, the back-off of failed saves
	 * @param {Object} options.health SaveHealth, told about every save's outcome
	 * @param {Object} [options.logger] console-like logger
	 */
	constructor({ store, finalSaveRetryMs, retry, health, logger = console }) {
		this.store = store;
		this.finalSaveRetryMs = finalSaveRetryMs;
		this.retry = retry;
		this.health = health;
		this.logger = logger;
	}

	/**
	 * This function saves a doc and reports whether Gaia took it. A failure
	 * is logged with the doc name and the error's own message (a Gaia
	 * status), never tokens or content, and is not thrown: Hocuspocus does
	 * not handle rejections from its save timers. A failed save is retried.
	 *
	 * @method trySave
	 * @param {String} documentName
	 * @param {Y.Doc} document
	 * @param {Boolean} render Also write html and plainText
	 * @returns {Promise<Boolean>}
	 * @public
	 */
	async trySave(documentName, document, render) {
		let saved;
		try {
			saved = await this.store.save(documentName, document, { render });
		} catch (error) {
			this.logger.error(`collab: ${documentName} not saved (${error.message})`);
			saved = false;
		}
		this.record(documentName, document, saved, render);
		return saved;
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

	/**
	 * This function stops the retries of an unloaded doc.
	 *
	 * @method forget
	 * @param {String} documentName
	 * @public
	 */
	forget(documentName) {
		this.retry.cancel(documentName);
		this.health.forget(documentName);
	}

	/**
	 * @method record
	 * @param {String} documentName
	 * @param {Y.Doc} document
	 * @param {Boolean} saved
	 * @param {Boolean} render
	 * @private
	 */
	record(documentName, document, saved, render) {
		if (!this.store.has(documentName)) {
			return;
		}
		if (saved) {
			this.health.saved(documentName);
			this.retry.cancel(documentName);
			return;
		}
		this.health.failed(documentName);
		this.retry.schedule(documentName, render, (retryRender) => this.trySave(documentName, document, retryRender));
	}
}

module.exports = { SavePolicy };
