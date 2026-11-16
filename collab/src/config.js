const { DEFAULT_MAX_UPDATE_BYTES, DEFAULT_MAX_UPDATES_PER_SECOND } = require('./update-limits');

const DEFAULT_PORT = 1234;
const DEV_SECRET = 'collab-dev-secret';
const LOCAL_ENVS = ['development', 'test'];

/**
 * This function reads a positive integer variable.
 *
 * @method positiveInteger
 * @param {Object} env
 * @param {String} name
 * @param {Number} fallback Used when the variable is unset or empty
 * @returns {Number}
 * @throws {Error} When the value is not a positive integer
 * @private
 */
function positiveInteger(env, name, fallback) {
	if (env[name] === undefined || env[name] === '') {
		return fallback;
	}
	const value = Number(env[name]);
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

/**
 * This function reads the shared secret of the internal endpoint (D-023).
 * The development default is used only when NODE_ENV is development or test;
 * anywhere else COLLAB_SECRET must be set and must not be that default.
 *
 * @method readSecret
 * @param {Object} env
 * @returns {String}
 * @throws {Error} When the secret is missing or the default outside local dev
 * @private
 */
function readSecret(env) {
	const nodeEnv = env.NODE_ENV || 'development';
	const secret = env.COLLAB_SECRET || '';
	if (LOCAL_ENVS.includes(nodeEnv)) {
		return secret || DEV_SECRET;
	}
	if (secret === '' || secret === DEV_SECRET) {
		throw new Error(`COLLAB_SECRET must be set, and not to the development default, when NODE_ENV is "${nodeEnv}"`);
	}
	return secret;
}

/**
 * This function reads the collab server's configuration from the
 * environment: `GAIA_URL` (required), `COLLAB_PORT` (1234 by default),
 * `COLLAB_SECRET`, `COLLAB_ALLOWED_ORIGINS` (comma-separated, empty allows
 * every origin), `COLLAB_MAX_UPDATE_BYTES` and `COLLAB_MAX_UPDATES_PER_SECOND`.
 *
 * @method loadConfig
 * @param {Object} [env] Environment variables
 * @returns {{gaiaUrl: String, port: Number, secret: String, allowedOrigins: String[],
 *   limits: {maxUpdateBytes: Number, maxUpdatesPerSecond: Number}}}
 * @throws {Error} When a variable is missing or invalid
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
	return {
		gaiaUrl,
		port,
		secret: readSecret(env),
		allowedOrigins: String(env.COLLAB_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
		limits: {
			maxUpdateBytes: positiveInteger(env, 'COLLAB_MAX_UPDATE_BYTES', DEFAULT_MAX_UPDATE_BYTES),
			maxUpdatesPerSecond: positiveInteger(env, 'COLLAB_MAX_UPDATES_PER_SECOND', DEFAULT_MAX_UPDATES_PER_SECOND)
		}
	};
}

module.exports = { loadConfig, DEFAULT_PORT, DEV_SECRET };
