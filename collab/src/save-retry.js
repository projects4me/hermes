/**
 * Back-off timers for retrying a doc's failed save.
 */

/**
 * @class SaveRetry
 * @public
 */
class SaveRetry {
	/**
	 * @param {Object} options
	 * @param {Number[]} options.retryMs Waits before each retry; the last one repeats
	 */
	constructor({ retryMs }) {
		this.retryMs = retryMs;
		this.docs = new Map();
	}

	/**
	 * This function runs `run(render)` after the doc's next back-off wait,
	 * unless a retry is already waiting. A render asked for by any failed
	 * save is kept for the retry.
	 *
	 * @method schedule
	 * @param {String} documentName
	 * @param {Boolean} render
	 * @param {Function} run function(render)
	 * @public
	 */
	schedule(documentName, render, run) {
		const entry = this.docs.get(documentName) ?? { attempt: 0, timer: null, render: false };
		entry.render = entry.render || render;
		this.docs.set(documentName, entry);
		if (entry.timer) {
			return;
		}
		const waitMs = this.retryMs[Math.min(entry.attempt, this.retryMs.length - 1)];
		entry.attempt += 1;
		entry.timer = setTimeout(() => {
			entry.timer = null;
			const wantsRender = entry.render;
			entry.render = false;
			run(wantsRender);
		}, waitMs);
		entry.timer.unref?.();
	}

	/**
	 * This function stops a doc's retries and restarts its back-off.
	 *
	 * @method cancel
	 * @param {String} documentName
	 * @public
	 */
	cancel(documentName) {
		clearTimeout(this.docs.get(documentName)?.timer);
		this.docs.delete(documentName);
	}
}

module.exports = { SaveRetry };
