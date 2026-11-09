const { sendGaiaRequest, GaiaHttpError } = require('./gaia-http');

const ENROLLMENT_PATH = '/api/v1/serviceenrollment';
const TOKEN_PATH = '/api/v1/token';
const SERVICE_CLIENT_PATH = '/api/v1/serviceclient';

/**
 * Gateway to the Gaia endpoints Hermes uses for its own identity: service
 * enrollment (request and poll), the client_credentials grant and secret
 * rotation. It only maps calls to HTTP; when to call them is
 * `service-identity.js`'s job.
 *
 * @method createGaiaIdentityClient
 * @param {Object} options
 * @param {String} options.gaiaUrl Gaia origin without a trailing slash
 * @param {Number} [options.timeoutMs] Request timeout
 * @returns {Object} The client
 * @public
 */
function createGaiaIdentityClient({ gaiaUrl, timeoutMs = 10000 }) {
	const jsonHeaders = { Accept: 'application/json', 'Content-Type': 'application/json' };

	return {
		/**
		 * Creates an enrollment request (D-066 "Services enroll themselves";
		 * approved at once when it carries a valid enrollment token, D-070).
		 *
		 * @method requestEnrollment
		 * @param {Object} request
		 * @param {String} request.name Service name shown to the admin
		 * @param {String} request.kind Service kind (`hermes`)
		 * @param {String} [request.enrollmentToken] Single-use enrollment token
		 * @returns {Promise<{id: String, status: String, userCode: String, expiresAt: String, pollToken: String}>}
		 */
		async requestEnrollment({ name, kind, enrollmentToken }) {
			const attributes = { name, kind };
			if (enrollmentToken) {
				attributes.enrollmentToken = enrollmentToken;
			}
			const document = await sendGaiaRequest({
				method: 'POST',
				url: `${gaiaUrl}${ENROLLMENT_PATH}`,
				headers: jsonHeaders,
				body: JSON.stringify({ data: { type: 'serviceenrollment', attributes } }),
				timeoutMs,
				label: 'enrollment request'
			});
			const data = document?.data || {};
			const attrs = data.attributes || {};
			if (!data.id || !attrs.pollToken) {
				throw new GaiaHttpError('gaia enrollment request returned no id or poll token');
			}
			return {
				id: String(data.id),
				status: attrs.status,
				userCode: attrs.userCode,
				expiresAt: attrs.expiresAt,
				pollToken: attrs.pollToken
			};
		},

		/**
		 * Polls an enrollment request. The poll that delivers returns the
		 * credential once; it is not retried blindly by this client.
		 *
		 * @method pollEnrollment
		 * @param {String} id Enrollment request id
		 * @param {String} pollToken Poll token from the request
		 * @returns {Promise<{status: String, credential: Object|null}>}
		 */
		async pollEnrollment(id, pollToken) {
			const document = await sendGaiaRequest({
				method: 'GET',
				url: `${gaiaUrl}${ENROLLMENT_PATH}/${encodeURIComponent(id)}?pollToken=${encodeURIComponent(pollToken)}`,
				headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
				timeoutMs,
				label: 'enrollment poll'
			});
			const attrs = document?.data?.attributes || {};
			const credential = attrs.clientId && attrs.clientSecret
				? {
					clientId: attrs.clientId,
					clientSecret: attrs.clientSecret,
					serviceClientId: attrs.serviceClientId || null
				}
				: null;
			return { status: attrs.status, credential };
		},

		/**
		 * Gets an access token with the client_credentials grant.
		 *
		 * @method fetchToken
		 * @param {Object} credential
		 * @param {String} credential.clientId OAuth client id
		 * @param {String} credential.clientSecret OAuth client secret
		 * @returns {Promise<{accessToken: String, expiresIn: Number}>}
		 */
		async fetchToken({ clientId, clientSecret }) {
			const body = new URLSearchParams({
				grant_type: 'client_credentials',
				client_id: clientId,
				client_secret: clientSecret
			}).toString();
			const answer = await sendGaiaRequest({
				method: 'POST',
				url: `${gaiaUrl}${TOKEN_PATH}`,
				headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
				timeoutMs,
				label: 'token'
			});
			const expiresIn = Number.parseInt(answer?.expires_in, 10);
			if (!answer?.access_token || !Number.isInteger(expiresIn) || expiresIn <= 0) {
				throw new GaiaHttpError('gaia token returned no access token or expiry');
			}
			return { accessToken: answer.access_token, expiresIn };
		},

		/**
		 * Rotates the service's own secret (D-068). The previous secret stays
		 * valid for Gaia's grace period.
		 *
		 * @method rotateSecret
		 * @param {String} serviceClientId Serviceclient record id
		 * @param {String} accessToken The service's own access token
		 * @returns {Promise<{clientId: String, clientSecret: String}>}
		 */
		async rotateSecret(serviceClientId, accessToken) {
			const document = await sendGaiaRequest({
				method: 'PATCH',
				url: `${gaiaUrl}${SERVICE_CLIENT_PATH}/${encodeURIComponent(serviceClientId)}`,
				headers: { ...jsonHeaders, Authorization: `Bearer ${accessToken}` },
				body: JSON.stringify({
					data: { type: 'serviceclient', id: serviceClientId, attributes: { rotateSecret: true } }
				}),
				timeoutMs,
				label: 'secret rotation'
			});
			const attrs = document?.data?.attributes || {};
			if (!attrs.clientSecret) {
				throw new GaiaHttpError('gaia secret rotation returned no secret');
			}
			return { clientId: attrs.clientId, clientSecret: attrs.clientSecret };
		}
	};
}

module.exports = { createGaiaIdentityClient };
