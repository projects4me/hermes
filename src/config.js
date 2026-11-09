const os = require('os');

const DEV_SECRET = 'hermes-dev-secret';
const LOCAL_ENVS = ['development', 'test'];

/**
 * This function parses a positive integer env value, falling back when the
 * value is missing or invalid.
 *
 * @method positiveInteger
 * @param {String|Number} value Raw env value
 * @param {Number} fallback Default used when parsing fails
 * @returns {Number}
 * @private
 */
function positiveInteger(value, fallback) {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * This function splits CORS_ORIGIN into a trimmed origin list.
 *
 * @method parseOriginList
 * @param {String} corsOrigin Comma-separated origins
 * @returns {Array<String>}
 * @private
 */
function parseOriginList(corsOrigin) {
	return String(corsOrigin || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
}

/**
 * This function returns true when the origin hostname is loopback.
 *
 * @method isLoopbackOrigin
 * @param {String} origin Origin URL
 * @returns {Boolean}
 * @public
 */
function isLoopbackOrigin(origin) {
	try {
		const url = new URL(origin);
		return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
	} catch (_error) {
		return false;
	}
}

/**
 * Socket.IO CORS origin option. Development reflects the request Origin so
 * Firefox (`127.0.0.1` vs `localhost`) and LAN testing are not blocked.
 *
 * @method corsOriginOption
 * @param {String} corsOrigin Configured CORS_ORIGIN
 * @param {String} nodeEnv NODE_ENV
 * @returns {Boolean|Function} Socket.IO cors.origin option
 * @public
 */
function corsOriginOption(corsOrigin, nodeEnv = 'development') {
	const allowed = parseOriginList(corsOrigin);
	if (nodeEnv !== 'production' || allowed.includes('*')) {
		return true;
	}

	return (origin, callback) => {
		if (!origin || allowed.includes(origin) || isLoopbackOrigin(origin)) {
			return callback(null, true);
		}
		return callback(new Error('origin not allowed'));
	};
}

/**
 * This function loads Hermes runtime config from the environment.
 *
 * @method loadConfig
 * @param {Object} env Process env (defaults to process.env)
 * @returns {Object} Runtime config
 * @public
 */
function loadConfig(env = process.env) {
	const nodeEnv = env.NODE_ENV || 'development';
	const hermesSecret = env.HERMES_SECRET;
	const corsOrigin = env.CORS_ORIGIN;

	const isLocal = LOCAL_ENVS.includes(nodeEnv);

	if (!isLocal) {
		if (!hermesSecret) {
			throw new Error(`HERMES_SECRET is required when NODE_ENV is "${nodeEnv}"`);
		}
		if (hermesSecret === DEV_SECRET) {
			throw new Error(`HERMES_SECRET must not be the development default when NODE_ENV is "${nodeEnv}"`);
		}
	}

	if (nodeEnv === 'production') {
		if (!corsOrigin) {
			throw new Error('CORS_ORIGIN is required in production');
		}
	}

	return {
		nodeEnv,
		port: positiveInteger(env.PORT, 9000),
		hermesSecret: hermesSecret || DEV_SECRET,
		gaiaUrl: (env.GAIA_URL || 'http://localhost:8080').replace(/\/$/, ''),
		corsOrigin: corsOrigin || 'http://localhost:4200',
		authCacheTtlMs: positiveInteger(env.AUTH_CACHE_TTL_MS, 5 * 60 * 1000),
		authCacheMaxEntries: positiveInteger(env.AUTH_CACHE_MAX_ENTRIES, 1000),
		identity: {
			credentialFile: env.HERMES_CREDENTIAL_FILE || null,
			enrollmentToken: env.GAIA_ENROLLMENT_TOKEN || null,
			serviceName: env.HERMES_SERVICE_NAME || `Hermes ${os.hostname()}`,
			pollIntervalMs: positiveInteger(env.HERMES_ENROLLMENT_POLL_MS, 5000),
			retryDelayMs: positiveInteger(env.HERMES_IDENTITY_RETRY_MS, 60000),
			rotationIntervalMs: positiveInteger(env.HERMES_SECRET_ROTATION_MS, 7 * 24 * 60 * 60 * 1000)
		}
	};
}

module.exports = { loadConfig, corsOriginOption, isLoopbackOrigin };
