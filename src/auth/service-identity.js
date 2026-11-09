const { RetryScheduler } = require('./retry-scheduler');

const MAX_TIMER_MS = 2147483647;
const ENDED_STATUSES = ['denied', 'expired', 'delivered'];

/**
 * Keeps Hermes's own identity with Gaia (D-019). On start it loads the stored
 * credential or enrolls (with `GAIA_ENROLLMENT_TOKEN`, approved at once, or by
 * a user code an admin approves), gets a client_credentials token, refreshes
 * it before it expires and rotates the secret on a schedule.
 *
 * It only decides what to do when: Gaia calls go through the gateway
 * (`gaia-identity-client.js`), the file through `credential-store.js`, and
 * timers and retries through `retry-scheduler.js`, so a failure never stops
 * the relay. The secret, the token and the poll token are never logged; the
 * user code is logged once, for the admin.
 *
 * @class ServiceIdentity
 * @public
 */
class ServiceIdentity {
	/**
	 * @param {Object} options
	 * @param {Object} options.client Gaia identity gateway
	 * @param {Object} options.store Credential store (load/save)
	 * @param {Object} [options.logger] Logger with info/error
	 * @param {String} options.name Service name shown to the admin
	 * @param {String} [options.kind] Service client kind
	 * @param {String} [options.enrollmentToken] Single-use enrollment token
	 * @param {Number} [options.pollIntervalMs] Wait between enrollment polls
	 * @param {Number} [options.enrollmentTimeoutMs] Give up polling one request after this long
	 * @param {Number} [options.retryDelayMs] Wait before retrying a failed step
	 * @param {Number} [options.rotationIntervalMs] Age at which the secret is rotated
	 * @param {Number} [options.refreshRatio] Share of the token lifetime after which it is refreshed
	 * @param {Function} [options.now] Clock in ms
	 * @param {Object} [options.timers] setTimeout/clearTimeout for the default scheduler
	 * @param {RetryScheduler} [options.scheduler] Timers and retry policy
	 * @param {Function} [options.sleep] Async wait between polls (defaults to the scheduler's)
	 */
	constructor({
		client,
		store,
		logger = console,
		name,
		kind = 'hermes',
		enrollmentToken = null,
		pollIntervalMs = 5000,
		enrollmentTimeoutMs = 16 * 60 * 1000,
		retryDelayMs = 60000,
		rotationIntervalMs = 7 * 24 * 60 * 60 * 1000,
		refreshRatio = 0.8,
		now = Date.now,
		timers = { setTimeout, clearTimeout },
		scheduler = null,
		sleep = null
	}) {
		this.client = client;
		this.store = store;
		this.logger = logger;
		this.name = name;
		this.kind = kind;
		this.enrollmentToken = enrollmentToken || null;
		this.pollIntervalMs = pollIntervalMs;
		this.enrollmentTimeoutMs = enrollmentTimeoutMs;
		this.rotationIntervalMs = rotationIntervalMs;
		this.refreshRatio = refreshRatio;
		this.now = now;
		this.scheduler = scheduler || new RetryScheduler({ retryDelayMs, timers, logger });
		this.sleep = sleep || ((ms) => this.scheduler.sleep(ms));
		this.credential = null;
		this.token = null;
	}

	/**
	 * This function brings the identity up: credential, then token, then the
	 * rotation schedule. On failure it logs and tries again later.
	 *
	 * @method start
	 * @returns {Promise<Boolean>} True once a token is held
	 * @public
	 */
	start() {
		return this.scheduler.retry('start', () => this.bringUp());
	}

	/**
	 * This function returns the current access token, or null before the
	 * first one or after it expired.
	 *
	 * @method getAccessToken
	 * @returns {String|null}
	 * @public
	 */
	getAccessToken() {
		if (!this.token || this.token.expiresAt <= this.now()) {
			return null;
		}
		return this.token.accessToken;
	}

	/**
	 * This function cancels every pending timer and poll.
	 *
	 * @method stop
	 * @returns {void}
	 * @public
	 */
	stop() {
		this.scheduler.stop();
	}

	/**
	 * This function runs one attempt of the start sequence. A credential once
	 * delivered is kept in memory even if storing it failed, so a retry never
	 * enrolls again.
	 *
	 * @method bringUp
	 * @returns {Promise<void>}
	 * @private
	 */
	async bringUp() {
		if (!this.credential) {
			const stored = this.store.load();
			if (stored) {
				this.credential = stored;
				this.ensureIssuedAt();
			} else {
				await this.enroll();
			}
		}
		await this.refreshToken();
		this.scheduleRotation();
	}

	/**
	 * This function enrolls with Gaia and keeps the delivered credential. The
	 * enrollment token is single use, so only the first attempt sends it;
	 * later attempts fall back to admin approval.
	 *
	 * @method enroll
	 * @returns {Promise<void>}
	 * @private
	 */
	async enroll() {
		const enrollmentToken = this.enrollmentToken;
		this.enrollmentToken = null;
		let request;
		try {
			request = await this.client.requestEnrollment({ name: this.name, kind: this.kind, enrollmentToken });
		} catch (error) {
			if (enrollmentToken && error.status === 400) {
				throw new Error('the enrollment token was refused; the next attempt asks an admin for approval');
			}
			throw error;
		}
		if (request.status !== 'approved') {
			this.logger.info(`Hermes enrollment waits for approval: an admin approves user code ${request.userCode} in Projects4Me (expires ${request.expiresAt})`);
		}

		const giveUpAt = this.now() + this.enrollmentTimeoutMs;
		for (;;) {
			if (this.scheduler.stopped) {
				throw new Error('stopped');
			}
			if (this.now() > giveUpAt) {
				throw new Error('enrollment was not approved in time');
			}
			const polled = await this.pollOnce(request);
			if (polled.credential) {
				this.credential = { ...polled.credential, secretIssuedAt: new Date(this.now()).toISOString() };
				this.persist();
				this.logger.info('Hermes enrolled with Gaia');
				return;
			}
			if (ENDED_STATUSES.includes(polled.status)) {
				throw new Error(`enrollment ${polled.status}`);
			}
			await this.sleep(polled.waitMs);
		}
	}

	/**
	 * This function polls once and says how long to wait before the next
	 * poll. Network and server errors count as still pending; a 429 waits
	 * for its Retry-After; any other 4xx ends the request.
	 *
	 * @method pollOnce
	 * @param {Object} request Enrollment request
	 * @returns {Promise<{status: String, credential: Object|null, waitMs: Number}>}
	 * @private
	 */
	async pollOnce(request) {
		try {
			const polled = await this.client.pollEnrollment(request.id, request.pollToken);
			return { ...polled, waitMs: this.pollIntervalMs };
		} catch (error) {
			if (error.status === 429) {
				return { status: 'pending', credential: null, waitMs: this.scheduler.delayAfter(error, this.pollIntervalMs) };
			}
			if (error.status >= 400 && error.status < 500) {
				throw new Error(`enrollment poll refused (${error.status})`);
			}
			return { status: 'pending', credential: null, waitMs: this.pollIntervalMs };
		}
	}

	/**
	 * This function gets a new token and schedules the next refresh. A failed
	 * refresh is retried; the current token is kept until it expires.
	 *
	 * @method refreshToken
	 * @returns {Promise<void>}
	 * @private
	 */
	async refreshToken() {
		const { accessToken, expiresIn } = await this.client.fetchToken(this.credential);
		const lifetimeMs = expiresIn * 1000;
		this.token = { accessToken, expiresAt: this.now() + lifetimeMs };
		this.scheduler.schedule(
			'refresh',
			Math.max(1000, Math.floor(lifetimeMs * this.refreshRatio)),
			() => this.scheduler.retry('token refresh', () => this.refreshToken())
		);
	}

	/**
	 * This function schedules the next rotation from the secret's age.
	 *
	 * @method scheduleRotation
	 * @returns {void}
	 * @private
	 */
	scheduleRotation() {
		if (!this.credential.serviceClientId) {
			this.logger.error('Hermes service identity: no serviceClientId stored, so the secret is not rotated; delete the credential file and enroll again to enable rotation');
			return;
		}
		const dueAt = Date.parse(this.credential.secretIssuedAt) + this.rotationIntervalMs;
		const delay = Math.max(0, dueAt - this.now());
		if (delay > MAX_TIMER_MS) {
			this.scheduler.schedule('rotate', MAX_TIMER_MS, () => this.scheduleRotation());
			return;
		}
		this.scheduler.schedule('rotate', delay, () => this.scheduler.retry('secret rotation', () => this.rotate()));
	}

	/**
	 * This function rotates the secret and stores the new one at once, inside
	 * Gaia's grace period for the previous secret.
	 *
	 * @method rotate
	 * @returns {Promise<void>}
	 * @private
	 */
	async rotate() {
		const accessToken = this.getAccessToken();
		if (!accessToken) {
			throw new Error('no access token');
		}
		const rotated = await this.client.rotateSecret(this.credential.serviceClientId, accessToken);
		this.credential = {
			...this.credential,
			clientSecret: rotated.clientSecret,
			secretIssuedAt: new Date(this.now()).toISOString()
		};
		this.persist();
		this.logger.info('Hermes rotated its service secret');
		this.scheduleRotation();
	}

	/**
	 * This function stores the in-memory credential, retrying on failure: a
	 * delivered or rotated secret exists only in memory until the file has it.
	 *
	 * @method persist
	 * @returns {void}
	 * @private
	 */
	persist() {
		try {
			this.store.save(this.credential);
			this.scheduler.cancel('store credential');
		} catch (error) {
			this.logger.error(`Hermes service identity: could not store the credential (${error.code || error.message}); retrying`);
			this.scheduler.schedule('store credential', Math.min(this.scheduler.retryDelayMs, 30000), () => this.persist());
		}
	}

	/**
	 * This function fills in `secretIssuedAt` for a credential stored without
	 * it, so the rotation schedule survives restarts.
	 *
	 * @method ensureIssuedAt
	 * @returns {void}
	 * @private
	 */
	ensureIssuedAt() {
		if (!this.credential.secretIssuedAt || Number.isNaN(Date.parse(this.credential.secretIssuedAt))) {
			this.credential = { ...this.credential, secretIssuedAt: new Date(this.now()).toISOString() };
			this.persist();
		}
	}
}

module.exports = { ServiceIdentity };
