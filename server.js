/**
 * Hermes process entry. Loads config, composes the app, listens, and brings
 * up Hermes's own Gaia identity in the background (D-019).
 */
const { loadConfig } = require('./src/config');
const { createHermesApp } = require('./src/app');
const { createServiceIdentity } = require('./src/auth/identity-factory');

const config = loadConfig();
const { httpServer } = createHermesApp({ config });
const serviceIdentity = createServiceIdentity(config);

httpServer.listen(config.port, () => {
	console.log(`Hermes Socket.IO server running on port ${config.port}`);
	if (serviceIdentity) {
		serviceIdentity.start();
	} else {
		console.log('Hermes service identity is off (HERMES_CREDENTIAL_FILE is not set)');
	}
});

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, () => {
		if (serviceIdentity) {
			serviceIdentity.stop();
		}
		httpServer.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 5000).unref();
	});
}
