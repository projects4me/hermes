const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { corsOriginOption } = require('./config');
const { SessionCache } = require('./auth/session-cache');
const { createGaiaSessionLoader } = require('./auth/gaia-session');
const { createCounters } = require('./metrics');
const { registerHttp } = require('./http/register');
const { registerSocket } = require('./socket/register');
const { createAccessRecheck } = require('./socket/access-recheck');
const { createAccessChangeListener } = require('./socket/access-change-listener');

/**
 * This function composes the Express app, Socket.IO server, session cache,
 * access re-check, and HTTP/socket registrations.
 *
 * @method createHermesApp
 * @param {Object} options
 * @param {Object} options.config Runtime config from loadConfig
 * @param {Function} [options.getServiceToken] Returns Hermes's service token for introspection (D-019)
 * @param {Function} [options.loadSession] Gaia session loader (defaults to introspection)
 * @param {Object} [options.logger] Logger with info/error (defaults to console)
 * @param {Function} [options.now] Clock in ms
 * @param {Object} [options.timers] setTimeout/clearTimeout for the expiry disconnect
 * @returns {{app: Object, httpServer: Object, io: Object, counters: Object, sessionCache: SessionCache, recheckUserAccess: Function}}
 * @public
 */
function createHermesApp({
	config,
	getServiceToken = () => null,
	loadSession = createGaiaSessionLoader({ gaiaUrl: config.gaiaUrl, getServiceToken }),
	logger = console,
	now = Date.now,
	timers = { setTimeout, clearTimeout }
}) {
	const app = express();
	const httpServer = createServer(app);
	const io = new Server(httpServer, {
		allowEIO3: true,
		cors: {
			origin: corsOriginOption(config.corsOrigin, config.nodeEnv),
			methods: ['GET', 'POST'],
			allowedHeaders: ['authorization', 'content-type'],
			credentials: false
		}
	});
	const counters = createCounters();
	const sessionCache = new SessionCache({
		ttlMs: config.authCacheTtlMs,
		maxEntries: config.authCacheMaxEntries,
		now
	});

	app.use(express.json({ limit: '256kb' }));
	const recheckUserAccess = createAccessRecheck({ io, sessionCache, loadSession, counters, logger, now });
	const afterPublish = createAccessChangeListener({ recheckUserAccess, logger });
	const deps = { app, io, config, counters, sessionCache, loadSession, logger, now, timers, afterPublish };
	registerHttp(app, deps);
	registerSocket(io, deps);

	return {
		app,
		httpServer,
		io,
		counters,
		sessionCache,
		recheckUserAccess
	};
}

module.exports = {
	createHermesApp
};
