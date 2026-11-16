/**
 * Collab server process entry (D-022). Loads config and starts the
 * Hocuspocus server that holds Docs' Yjs documents and saves them to Gaia.
 */
const { loadConfig } = require('./src/config');
const { createCollabServer } = require('./src/collab-server');

const config = loadConfig();
const server = createCollabServer(config);

// ws drops frames far over the update limit before buffering them; the
// limit itself is checked per message (D-023).
server.listen(config.port, null, { maxPayload: config.limits.maxUpdateBytes * 2 }).then(() => {
	console.log(`collab: listening on port ${config.port}, Gaia ${config.gaiaUrl}`);
	if (config.allowedOrigins.length === 0) {
		console.log('collab: COLLAB_ALLOWED_ORIGINS is empty, every browser origin may connect');
	}
}).catch((error) => {
	console.error(`collab: could not listen on port ${config.port} (${error.message})`);
	process.exit(1);
});

// A failure Hocuspocus does not handle must not take every open doc with it.
process.on('unhandledRejection', (error) => {
	console.error(`collab: unhandled rejection (${error?.message ?? error})`);
});

// Leave time for the final saves (D-022): one Gaia call per writer, with retries.
for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, () => {
		server.destroy().finally(() => process.exit(0));
		setTimeout(() => process.exit(0), 30000).unref();
	});
}
