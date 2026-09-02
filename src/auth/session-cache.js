/**
 * This class caches Gaia session lookups for socket authentication. Entries
 * expire after ttlMs and the oldest entry is evicted when maxEntries is hit.
 *
 * @class SessionCache
 * @public
 */
class SessionCache {
	/**
	 * Creates an LRU-ish TTL cache for Gaia sessions.
	 *
	 * @method constructor
	 * @param {Object} options
	 * @param {Number} options.ttlMs Time-to-live in milliseconds
	 * @param {Number} options.maxEntries Maximum cached tokens
	 * @param {Function} [options.now] Clock used for expiry (defaults to Date.now)
	 * @public
	 */
	constructor({ ttlMs, maxEntries, now = Date.now }) {
		this.ttlMs = ttlMs;
		this.maxEntries = maxEntries;
		this.now = now;
		this.entries = new Map();
		this.evictions = 0;
	}

	/**
	 * Number of non-expired entries. Prunes expired keys first.
	 *
	 * @property size
	 * @type Number
	 * @for SessionCache
	 * @public
	 */
	get size() {
		this.prune();
		return this.entries.size;
	}

	/**
	 * Returns the cached session for the token, or null when missing/expired.
	 *
	 * @method get
	 * @param {String} token OAuth access token
	 * @returns {Object|null} Cached { userId, projectIds }
	 * @public
	 */
	get(token) {
		const entry = this.entries.get(token);
		if (!entry) {
			return null;
		}
		if (this.now() >= entry.expiresAt) {
			this.entries.delete(token);
			return null;
		}
		this.entries.delete(token);
		this.entries.set(token, entry);
		return entry.session;
	}

	/**
	 * Stores a session for the token, evicting the oldest entry if needed.
	 *
	 * @method set
	 * @param {String} token OAuth access token
	 * @param {Object} session { userId, projectIds }
	 * @returns {void}
	 * @public
	 */
	set(token, session) {
		this.prune();
		this.entries.delete(token);
		while (this.entries.size >= this.maxEntries) {
			this.entries.delete(this.entries.keys().next().value);
			this.evictions += 1;
		}
		this.entries.set(token, {
			session,
			expiresAt: this.now() + this.ttlMs
		});
	}

	/**
	 * Removes expired entries.
	 *
	 * @method prune
	 * @returns {void}
	 * @private
	 */
	prune() {
		const now = this.now();
		for (const [token, entry] of this.entries) {
			if (now >= entry.expiresAt) {
				this.entries.delete(token);
			}
		}
	}
}

module.exports = { SessionCache };
