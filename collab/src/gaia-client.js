/**
 * Gaia gateway of the collab server. Every call is made with the connected
 * user's own OAuth token (Gaia Docs D-003), so Gaia's ACL decides what the
 * user may read and write. Modelled on the relay's `src/auth/gaia-session.js`
 * but kept separate: collab/ shares no code with the relay (D-022).
 */

/**
 * Error from a Gaia call. It carries the HTTP status but never the request,
 * the token or the response body, so neither can reach a log through it.
 *
 * @class GaiaError
 * @public
 */
class GaiaError extends Error {
	/**
	 * @param {String} message Message without tokens or content
	 * @param {Number} [status] HTTP status, if Gaia answered
	 */
	constructor(message, status) {
		super(message);
		this.name = 'GaiaError';
		this.status = status;
	}
}

/**
 * This function returns the Gaia client used by the collab server.
 *
 * @method createGaiaClient
 * @param {Object} options
 * @param {String} options.gaiaUrl Gaia origin without a trailing slash
 * @param {Number} [options.timeoutMs] Request timeout
 * @returns {Object} `{getMe, getDoc, findContent, createContent, updateContent}`
 * @public
 */
function createGaiaClient({ gaiaUrl, timeoutMs = 5000 }) {
	/**
	 * This function sends one JSON:API request to Gaia and parses the answer.
	 *
	 * @method send
	 * @param {String} label Call name used in error messages
	 * @param {String} token User's OAuth access token
	 * @param {String} method HTTP method
	 * @param {String} path Path and query below the Gaia origin
	 * @param {Object} [body] JSON body
	 * @returns {Promise<Object>} Parsed body of a 2xx answer
	 * @throws {GaiaError} On a non-2xx answer, a timeout or a network error
	 * @private
	 */
	async function send(label, token, method, path, body) {
		let response;
		try {
			response = await fetch(`${gaiaUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/json',
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (error) {
			throw new GaiaError(`gaia ${label} unreachable (${error.name})`);
		}
		if (!response.ok) {
			await response.arrayBuffer().catch(() => null);
			throw new GaiaError(`gaia ${label} answered ${response.status}`, response.status);
		}
		try {
			return await response.json();
		} catch {
			throw new GaiaError(`gaia ${label} answered invalid JSON`, response.status);
		}
	}

	return {
		/**
		 * This function reads the token's user with its ACL permissions.
		 *
		 * @method getMe
		 * @param {String} token
		 * @returns {Promise<Object>} JSON:API body of `GET /api/v1/user/me`
		 * @public
		 */
		getMe(token) {
			return send('user/me', token, 'GET', '/api/v1/user/me?include=aclPermissions');
		},

		/**
		 * This function reads one doc as the token's user.
		 *
		 * @method getDoc
		 * @param {String} token
		 * @param {String} docId
		 * @returns {Promise<Object>} JSON:API body of `GET /api/v1/doc/{id}`
		 * @public
		 */
		getDoc(token, docId) {
			return send('doc', token, 'GET', `/api/v1/doc/${encodeURIComponent(docId)}`);
		},

		/**
		 * This function finds the Doccontent row of a doc (Gaia Docs D-004: one row per doc).
		 *
		 * @method findContent
		 * @param {String} token
		 * @param {String} docId
		 * @returns {Promise<{id: String, state: String|null, html: String|null}|null>} The row, or null
		 * @public
		 */
		async findContent(token, docId) {
			const query = new URLSearchParams({ query: `((Doccontent.docId : ${docId}))` });
			const body = await send('doccontent list', token, 'GET', `/api/v1/doccontent?${query}`);
			const row = Array.isArray(body?.data) ? body.data.find((item) => String(item?.attributes?.docId) === String(docId)) : null;
			if (!row) {
				return null;
			}
			return {
				id: String(row.id),
				state: typeof row.attributes.state === 'string' ? row.attributes.state : null,
				html: typeof row.attributes.html === 'string' ? row.attributes.html : null
			};
		},

		/**
		 * This function creates the Doccontent row of a doc.
		 *
		 * @method createContent
		 * @param {String} token
		 * @param {Object} attributes `docId`, `projectId`, `state`, `byteSize` and optionally `html`, `plainText`
		 * @returns {Promise<String>} Id of the new row
		 * @public
		 */
		async createContent(token, attributes) {
			const body = await send('doccontent create', token, 'POST', '/api/v1/doccontent', {
				data: { type: 'doccontent', attributes }
			});
			const id = body?.data?.id;
			if (id === undefined || id === null || id === '') {
				throw new GaiaError('gaia doccontent create answered without an id');
			}
			return String(id);
		},

		/**
		 * This function updates a Doccontent row.
		 *
		 * @method updateContent
		 * @param {String} token
		 * @param {String} contentId
		 * @param {Object} attributes `state`, `byteSize` and optionally `html`, `plainText`
		 * @returns {Promise<void>}
		 * @public
		 */
		async updateContent(token, contentId, attributes) {
			await send('doccontent update', token, 'PATCH', `/api/v1/doccontent/${encodeURIComponent(contentId)}`, {
				data: { type: 'doccontent', id: contentId, attributes }
			});
		}
	};
}

module.exports = { createGaiaClient, GaiaError };
