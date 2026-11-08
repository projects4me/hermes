const crypto = require('crypto');
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
 * This function compares two secrets without leaking timing. Different
 * lengths are rejected up front; equal-length buffers use timingSafeEqual.
 *
 * @method secretsMatch
 * @param {String|null} provided Secret from the request
 * @param {String} expected Configured secret
 * @returns {Boolean}
 * @public
 */
function secretsMatch(provided, expected) {
	if (typeof provided !== 'string' || typeof expected !== 'string') {
		return false;
	}
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && crypto.timingSafeEqual(a, b);
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
		if (!secretsMatch(sharedSecret(req), config.hermesSecret)) {
			counters.publish.rejected += 1;
			return res.status(401).json({ error: 'unauthorized' });
		}
		return next();
	};
}

module.exports = { sharedSecret, secretsMatch, requireSecret };
