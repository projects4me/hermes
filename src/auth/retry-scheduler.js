/**
 * Named, replaceable timers with a retry policy, for background work that
 * must never stop the process. One timer per name: scheduling a name again
 * replaces its timer. `stop()` cancels every timer and wakes every pending
 * `sleep()`.
 *
 * @class RetryScheduler
 * @public
 */
class RetryScheduler {
	/**
	 * @param {Object} [options]
	 * @param {Number} [options.retryDelayMs] Default wait before a retry
	 * @param {Object} [options.timers] setTimeout/clearTimeout
	 * @param {Object} [options.logger] Logger with error
	 */
	constructor({ retryDelayMs = 60000, timers = { setTimeout, clearTimeout }, logger = console } = {}) {
		this.retryDelayMs = retryDelayMs;
		this.timers = timers;
		this.logger = logger;
		this.handles = new Map();
		this.sleepers = new Set();
		this.sleepSeq = 0;
		this.stopped = false;
	}

	/**
	 * This function replaces the timer under `key`.
	 *
	 * @method schedule
	 * @param {String} key Timer name
	 * @param {Number} ms Delay
	 * @param {Function} fn Callback; its result is returned by the timer
	 * @returns {void}
	 * @public
	 */
	schedule(key, ms, fn) {
		if (this.stopped) {
			return;
		}
		this.cancel(key);
		const handle = this.timers.setTimeout(() => {
			this.handles.delete(key);
			return fn();
		}, ms);
		if (handle && typeof handle.unref === 'function') {
			handle.unref();
		}
		this.handles.set(key, handle);
	}

	/**
	 * This function cancels the timer under `key`, if any.
	 *
	 * @method cancel
	 * @param {String} key Timer name
	 * @returns {void}
	 * @public
	 */
	cancel(key) {
		if (this.handles.has(key)) {
			this.timers.clearTimeout(this.handles.get(key));
			this.handles.delete(key);
		}
	}

	/**
	 * This function waits `ms`; it resolves early when the scheduler stops.
	 *
	 * @method sleep
	 * @param {Number} ms Delay
	 * @returns {Promise<void>}
	 * @public
	 */
	sleep(ms) {
		return new Promise((resolve) => {
			if (this.stopped) {
				return resolve();
			}
			const wake = () => {
				this.sleepers.delete(wake);
				resolve();
			};
			this.sleepers.add(wake);
			this.sleepSeq += 1;
			this.schedule(`sleep:${this.sleepSeq}`, ms, wake);
		});
	}

	/**
	 * This function runs `step` now and, on failure, logs and schedules it
	 * again under `key` until it succeeds or the scheduler stops.
	 *
	 * @method retry
	 * @param {String} key Timer name, also used in the log line
	 * @param {Function} step Async step
	 * @returns {Promise<Boolean>} True when this run succeeded
	 * @public
	 */
	async retry(key, step) {
		try {
			await step();
			return true;
		} catch (error) {
			if (!this.stopped) {
				const delay = this.delayAfter(error);
				this.logger.error(`Hermes service identity: ${key} failed (${error.message}); retrying in ${Math.round(delay / 1000)}s`);
				this.schedule(key, delay, () => this.retry(key, step));
			}
			return false;
		}
	}

	/**
	 * This function picks the retry delay, honouring a 429's Retry-After.
	 *
	 * @method delayAfter
	 * @param {Error} error Failure
	 * @param {Number} [fallbackMs] Delay when there is no Retry-After
	 * @returns {Number} Delay in ms
	 * @public
	 */
	delayAfter(error, fallbackMs = this.retryDelayMs) {
		if (error && error.status === 429 && Number.isInteger(error.retryAfterSeconds)) {
			return Math.max(fallbackMs, error.retryAfterSeconds * 1000);
		}
		return fallbackMs;
	}

	/**
	 * This function cancels every timer and wakes every sleeper.
	 *
	 * @method stop
	 * @returns {void}
	 * @public
	 */
	stop() {
		this.stopped = true;
		for (const handle of this.handles.values()) {
			this.timers.clearTimeout(handle);
		}
		this.handles.clear();
		for (const wake of [...this.sleepers]) {
			wake();
		}
	}
}

module.exports = { RetryScheduler };
