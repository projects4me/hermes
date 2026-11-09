const { createHermesApp } = require('./app');
const { createServiceIdentity } = require('./auth/identity-factory');

/**
 * This function composes Hermes the way the process entry runs it: the app,
 * plus the service identity (D-019) started in the background once the
 * server listens. The identity never gates the relay (/publish, /health);
 * its token is what socket handshakes are introspected with (D-002).
 *
 * @method startHermes
 * @param {Object} config Runtime config from loadConfig
 * @param {Object} [deps]
 * @param {Object} [deps.logger] Logger with info/warn/error (defaults to console)
 * @param {Function} [deps.loadSession] Gaia session loader override
 * @returns {{httpServer: Object, io: Object, serviceIdentity: Object|null, listening: Promise<void>, stop: Function}}
 * @public
 */
function startHermes(config, { logger = console, loadSession } = {}) {
	const serviceIdentity = createServiceIdentity(config, logger);
	const appOptions = {
		config,
		logger,
		getServiceToken: () => (serviceIdentity ? serviceIdentity.getAccessToken() : null)
	};
	if (loadSession) {
		appOptions.loadSession = loadSession;
	}
	const { httpServer, io } = createHermesApp(appOptions);

	const listening = new Promise((resolve) => {
		httpServer.listen(config.port, () => {
			logger.info(`Hermes Socket.IO server running on port ${config.port}`);
			if (serviceIdentity) {
				serviceIdentity.start();
			} else {
				logger.info('Hermes service identity is off (HERMES_CREDENTIAL_FILE is not set): socket handshakes are refused, they need its token for introspection');
			}
			resolve();
		});
	});

	/**
	 * This function stops the identity timers and closes the server.
	 *
	 * @method stop
	 * @param {Function} [done] Called once the server is closed
	 * @returns {void}
	 * @public
	 */
	function stop(done) {
		if (serviceIdentity) {
			serviceIdentity.stop();
		}
		io.close(() => {
			if (done) {
				done();
			}
		});
	}

	return { httpServer, io, serviceIdentity, listening, stop };
}

module.exports = { startHermes };
