const { bearerToken } = require('../../auth/tokens');

/**
 * This function reads the shared ingest secret from X-Hermes-Secret or
 * Authorization: Bearer.
 *
 * @method sharedSecret
 * @param {Object} req Express request
 * @returns {String|null}
 * @public
 */
function sharedSecret(req) {
	return req.get('x-hermes-secret')
		|| bearerToken(req.get('authorization'))
		|| req.get('authorization');
}

/**
 * This function returns Express middleware that rejects /publish without the
 * configured HERMES_SECRET.
 *
 * @method requireSecret
 * @param {Object} deps
 * @param {Object} deps.config Runtime config
 * @param {Object} deps.counters In-memory counters
 * @returns {Function} Express middleware
 * @public
 */
function requireSecret({ config, counters }) {
	return (req, res, next) => {
		if (sharedSecret(req) !== config.hermesSecret) {
			counters.publish.rejected += 1;
			return res.status(401).json({ error: 'unauthorized' });
		}
		return next();
	};
}

module.exports = { sharedSecret, requireSecret };
