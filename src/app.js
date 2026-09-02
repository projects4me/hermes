const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { corsOriginOption } = require('./config');
const { SessionCache } = require('./auth/session-cache');
const { createGaiaSessionLoader } = require('./auth/gaia-session');
const { createCounters } = require('./metrics');
const { registerHttp } = require('./http/register');
const { registerSocket } = require('./socket/register');

/**
 * This function composes the Express app, Socket.IO server, session cache,
 * and HTTP/socket registrations.
 *
 * @method createHermesApp
 * @param {Object} options
 * @param {Object} options.config Runtime config from loadConfig
 * @param {Function} [options.loadSession] Gaia session loader
 * @param {Object} [options.logger] Logger with info/error (defaults to console)
 * @returns {{app: Object, httpServer: Object, io: Object, counters: Object, sessionCache: SessionCache}}
 * @public
 */
function createHermesApp({
	config,
	loadSession = createGaiaSessionLoader(config.gaiaUrl),
	logger = console
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
		maxEntries: config.authCacheMaxEntries
	});

	app.use(express.json({ limit: '256kb' }));
	const deps = { app, io, config, counters, sessionCache, loadSession, logger };
	registerHttp(app, deps);
	registerSocket(io, deps);

	return {
		app,
		httpServer,
		io,
		counters,
		sessionCache
	};
}

module.exports = {
	createHermesApp
};
