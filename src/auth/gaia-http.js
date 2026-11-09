const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Error from a Gaia call. It carries the HTTP status and, for a 429, the
 * Retry-After seconds, but never the request or response body, so a secret
 * or token cannot reach a log through it.
 *
 * @class GaiaHttpError
 * @public
 */
class GaiaHttpError extends Error {
	/**
	 * @param {String} message Message without secrets
	 * @param {Number} [status] HTTP status, if Gaia answered
	 * @param {Number} [retryAfterSeconds] Retry-After of a 429
	 */
	constructor(message, status, retryAfterSeconds) {
		super(message);
		this.name = 'GaiaHttpError';
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/**
 * This function sends one request to Gaia and parses the JSON answer. It is
 * the one HTTP transport the Gaia gateways in `src/auth/` share.
 *
 * @method sendGaiaRequest
 * @param {Object} options
 * @param {String} [options.method] HTTP method (GET by default)
 * @param {String} options.url Absolute URL
 * @param {Object} [options.headers] Request headers
 * @param {String} [options.body] Request body
 * @param {Number} [options.timeoutMs] Socket timeout
 * @param {String} [options.label] Call name used in error messages
 * @returns {Promise<Object>} Parsed JSON body of a 2xx answer
 * @public
 */
function sendGaiaRequest({ method = 'GET', url, headers = {}, body, timeoutMs = 4000, label = '' }) {
	const prefix = label ? `gaia ${label}` : 'gaia';
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const lib = target.protocol === 'https:' ? https : http;
		const req = lib.request({
			hostname: target.hostname,
			port: target.port,
			path: `${target.pathname}${target.search}`,
			method,
			headers: body === undefined ? headers : { ...headers, 'Content-Length': Buffer.byteLength(body) },
			timeout: timeoutMs
		}, (res) => {
			let raw = '';
			res.on('data', (chunk) => {
				raw += chunk;
			});
			res.on('end', () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					const retryAfter = Number.parseInt(res.headers['retry-after'], 10);
					return reject(new GaiaHttpError(
						`${prefix} ${res.statusCode}`,
						res.statusCode,
						Number.isInteger(retryAfter) ? retryAfter : undefined
					));
				}
				try {
					return resolve(JSON.parse(raw));
				} catch (_error) {
					return reject(new GaiaHttpError(`${prefix} returned invalid JSON`, res.statusCode));
				}
			});
		});
		req.on('error', (error) => reject(new GaiaHttpError(`${prefix} failed: ${error.code || error.message}`)));
		req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
		if (body !== undefined) {
			req.write(body);
		}
		req.end();
	});
}

module.exports = { sendGaiaRequest, GaiaHttpError };
