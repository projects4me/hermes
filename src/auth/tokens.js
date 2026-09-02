/**
 * This function extracts a Bearer token from an Authorization header.
 *
 * @method bearerToken
 * @param {String} header Authorization header value
 * @returns {String|null}
 * @public
 */
function bearerToken(header) {
	if (!header || typeof header !== 'string') {
		return null;
	}
	const match = header.match(/^Bearer\s+(.+)$/i);
	return match ? match[1] : null;
}

/**
 * This function returns the first non-empty string from a string or array.
 *
 * @method firstString
 * @param {*} value String or array of strings
 * @returns {String|null}
 * @private
 */
function firstString(value) {
	if (typeof value === 'string' && value) {
		return value;
	}
	if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) {
		return value[0];
	}
	return null;
}

/**
 * This function normalizes handshake.auth into an object. Engine.IO may
 * deliver it as a JSON string.
 *
 * @method parseHandshakeAuth
 * @param {Object|String} handshakeAuth Socket.IO handshake.auth
 * @returns {Object}
 * @private
 */
function parseHandshakeAuth(handshakeAuth) {
	if (!handshakeAuth) {
		return {};
	}
	if (typeof handshakeAuth === 'string') {
		try {
			const parsed = JSON.parse(handshakeAuth);
			return parsed && typeof parsed === 'object' ? parsed : {};
		} catch (_error) {
			return {};
		}
	}
	return handshakeAuth;
}

/**
 * This function extracts the user OAuth token from a Socket.IO handshake.
 * Prefers auth.token, then Authorization: Bearer.
 *
 * @method extractSocketToken
 * @param {Object} handshake Socket.IO handshake
 * @returns {{token: String, source: String}|null}
 * @public
 */
function extractSocketToken(handshake) {
	const auth = parseHandshakeAuth(handshake.auth);
	const authToken = firstString(auth.token);
	if (authToken) {
		return { token: authToken, source: 'auth' };
	}

	const headerToken = bearerToken(handshake.headers?.authorization);
	if (headerToken) {
		return { token: headerToken, source: 'header' };
	}

	return null;
}

module.exports = {
	bearerToken,
	extractSocketToken
};
