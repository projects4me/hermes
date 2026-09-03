/**
 * This function creates the in-memory auth, intent, and publish counters
 * reported by GET /health.
 *
 * @method createCounters
 * @returns {Object} Mutable counter buckets
 * @public
 */
function createCounters() {
	return {
		auth: { accepted: 0, rejected: 0, cacheHits: 0, cacheMisses: 0 },
		intents: { setsAccepted: 0, setsRejected: 0, staleRevisions: 0, accepted: 0, rejected: 0 },
		publish: { accepted: 0, rejected: 0, emitted: 0, zeroSubscribers: 0 }
	};
}

module.exports = { createCounters };
