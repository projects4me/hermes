/**
 * This function creates the in-memory auth, intent, publish and access re-check counters
 * reported by GET /health.
 *
 * @method createCounters
 * @returns {Object} Mutable counter buckets
 * @public
 */
function createCounters() {
	return {
		auth: { accepted: 0, rejected: 0, cacheHits: 0, cacheMisses: 0, expired: 0 },
		intents: { setsAccepted: 0, setsRejected: 0, staleRevisions: 0, accepted: 0, rejected: 0 },
		publish: { accepted: 0, rejected: 0, emitted: 0, zeroSubscribers: 0 },
		access: { events: 0, socketsRechecked: 0, socketsDisconnected: 0, intentsDropped: 0, failures: 0 }
	};
}

module.exports = { createCounters };
