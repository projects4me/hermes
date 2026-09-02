/**
 * Hermes process entry. Loads config, composes the app, and listens.
 */
const { loadConfig } = require('./src/config');
const { createHermesApp } = require('./src/app');

const config = loadConfig();
const { httpServer } = createHermesApp({ config });

httpServer.listen(config.port, () => {
	console.log(`Hermes Socket.IO server running on port ${config.port}`);
});
