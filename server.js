/**
 * Hermes process entry. Loads config and starts Hermes (app, listener and
 * the background Gaia identity, D-019, whose token checks socket tokens
 * through Gaia introspection, D-002).
 */
const { loadConfig } = require('./src/config');
const { startHermes } = require('./src/start-hermes');

const hermes = startHermes(loadConfig());

for (const signal of ['SIGTERM', 'SIGINT']) {
	process.once(signal, () => {
		hermes.stop(() => process.exit(0));
		setTimeout(() => process.exit(0), 5000).unref();
	});
}
