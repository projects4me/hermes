const DEFAULT_PORT = 1234;

/**
 * This function reads the collab server's configuration from the
 * environment: `GAIA_URL` (required) and `COLLAB_PORT` (1234 by default).
 *
 * @method loadConfig
 * @param {Object} [env] Environment variables
 * @returns {{gaiaUrl: String, port: Number}}
 * @throws {Error} When GAIA_URL is missing or COLLAB_PORT is not a port
 * @public
 */
function loadConfig(env = process.env) {
	const gaiaUrl = (env.GAIA_URL || '').trim().replace(/\/+$/, '');
	if (!/^https?:\/\/\S+$/.test(gaiaUrl)) {
		throw new Error('GAIA_URL must be the Gaia origin, e.g. http://localhost:8080');
	}
	const port = env.COLLAB_PORT === undefined || env.COLLAB_PORT === '' ? DEFAULT_PORT : Number(env.COLLAB_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('COLLAB_PORT must be a port number');
	}
	return { gaiaUrl, port };
}

module.exports = { loadConfig, DEFAULT_PORT };
