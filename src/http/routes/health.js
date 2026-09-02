/**
 * This function returns the Express handler for GET /health.
 *
 * @method createHealthHandler
 * @param {Object} deps
 * @param {Object} deps.io Socket.IO server
 * @param {Object} deps.sessionCache SessionCache instance
 * @param {Object} deps.counters In-memory counters
 * @returns {Function} Express request handler
 * @public
 */
function createHealthHandler({ io, sessionCache, counters }) {
	return (_req, res) => {
		res.json({
			ok: true,
			uptimeSeconds: Math.floor(process.uptime()),
			sockets: {
				connected: io.engine.clientsCount
			},
			authCache: {
				size: sessionCache.size,
				maxEntries: sessionCache.maxEntries,
				ttlMs: sessionCache.ttlMs,
				evictions: sessionCache.evictions
			},
			counters
		});
	};
}

module.exports = { createHealthHandler };
