/**
 * Timers that call back once a doc has had no changes for a while, so its
 * html and plain text are written when editing pauses.
 *
 * @class RenderScheduler
 * @public
 */
class RenderScheduler {
	/**
	 * @param {Object} options
	 * @param {Number} options.idleMs Quiet time before `onIdle` runs
	 * @param {Function} options.onIdle Called with (documentName, document)
	 */
	constructor({ idleMs, onIdle }) {
		this.idleMs = idleMs;
		this.onIdle = onIdle;
		this.timers = new Map();
	}

	/**
	 * This function (re)starts the doc's idle timer.
	 *
	 * @method changed
	 * @param {String} documentName
	 * @param {Y.Doc} document
	 * @public
	 */
	changed(documentName, document) {
		this.cancel(documentName);
		const timer = setTimeout(() => {
			this.timers.delete(documentName);
			this.onIdle(documentName, document);
		}, this.idleMs);
		timer.unref();
		this.timers.set(documentName, timer);
	}

	/**
	 * @method cancel
	 * @param {String} documentName
	 * @public
	 */
	cancel(documentName) {
		clearTimeout(this.timers.get(documentName));
		this.timers.delete(documentName);
	}
}

module.exports = { RenderScheduler };
