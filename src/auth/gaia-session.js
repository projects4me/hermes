const { sendGaiaRequest } = require('./gaia-http');

const INTROSPECT_PATH = '/api/v1/introspect';

/**
 * This function maps a Gaia introspection answer (Gaia D-065) to a socket
 * session, or null when the token is not active or the answer lacks what a
 * session needs (an actor type and an expiry).
 *
 * @method toSession
 * @param {Object} answer Parsed introspection body
 * @returns {{userId: String|null, actorType: String, serviceKind: String|null, projectIds: Array<String>, expiresAt: Number}|null}
 * @private
 */
function toSession(answer) {
	if (answer?.active !== true || typeof answer.actorType !== 'string') {
		return null;
	}
	const exp = Number(answer.exp);
	if (!Number.isFinite(exp) || exp <= 0) {
		return null;
	}
	const projectIds = Array.isArray(answer.projectIds) ? answer.projectIds : [];
	return {
		userId: answer.sub === null || answer.sub === undefined ? null : String(answer.sub),
		actorType: answer.actorType,
		serviceKind: typeof answer.serviceKind === 'string' ? answer.serviceKind : null,
		projectIds: projectIds.filter((id) => id !== null && id !== undefined && id !== '').map(String),
		expiresAt: exp * 1000
	};
}

/**
 * This function returns a loader that checks a socket token with one Gaia
 * introspection call (`POST /api/v1/introspect`), made with Hermes's own
 * service token (D-019). It is the gateway to Gaia for socket auth: who may
 * open a socket is decided by the socket middleware.
 *
 * @method createGaiaSessionLoader
 * @param {Object} options
 * @param {String} options.gaiaUrl Gaia origin without a trailing slash
 * @param {Function} options.getServiceToken Returns Hermes's current service token or null
 * @param {Number} [options.timeoutMs] Request timeout
 * @returns {Function} Async function(token) → session or null
 * @public
 */
function createGaiaSessionLoader({ gaiaUrl, getServiceToken, timeoutMs = 4000 }) {
	/**
	 * This function introspects one socket token.
	 *
	 * @method loadGaiaSession
	 * @param {String} token OAuth access token from the handshake
	 * @returns {Promise<Object|null>} Session, or null when the token is not active
	 * @throws {Error} When Hermes holds no service token, or Gaia cannot be reached
	 * @private
	 */
	return async function loadGaiaSession(token) {
		const serviceToken = getServiceToken();
		if (!serviceToken) {
			throw new Error('no Hermes service token for introspection');
		}
		const answer = await sendGaiaRequest({
			method: 'POST',
			url: `${gaiaUrl}${INTROSPECT_PATH}`,
			headers: {
				Authorization: `Bearer ${serviceToken}`,
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({ token }).toString(),
			timeoutMs,
			label: 'introspection'
		});
		return toSession(answer);
	};
}

module.exports = { createGaiaSessionLoader, toSession };
