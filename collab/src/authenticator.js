const { parseDocumentName, allowedEntities, canOpen, canWrite } = require('./access');

const REFUSED_STATUSES = new Set([401, 403, 404]);

/**
 * Error for a refused connection. Its message names the reason, never the
 * token.
 *
 * @class AccessDenied
 * @public
 */
class AccessDenied extends Error {
	constructor(reason) {
		super(`access denied: ${reason}`);
		this.name = 'AccessDenied';
	}
}

/**
 * This function returns the check run when a client opens `doc:<docId>`
 * with its Gaia OAuth access token: `GET /api/v1/user/me` (needs `doc.get`),
 * then `GET /api/v1/doc/<id>` with the same token.
 *
 * @method createAuthenticator
 * @param {Object} options
 * @param {Object} options.gaia Gaia client (createGaiaClient)
 * @returns {Function} Async function({token, documentName}) → `{userId, docId, projectId, canWrite}`
 * @public
 */
function createAuthenticator({ gaia }) {
	/**
	 * This function calls Gaia and turns its refusals into AccessDenied.
	 *
	 * @method askGaia
	 * @param {Function} call
	 * @param {String} reason
	 * @returns {Promise<Object>}
	 * @throws {AccessDenied} When Gaia answers 401, 403 or 404
	 * @private
	 */
	async function askGaia(call, reason) {
		try {
			return await call();
		} catch (error) {
			if (REFUSED_STATUSES.has(error.status)) {
				throw new AccessDenied(reason);
			}
			throw error;
		}
	}

	/**
	 * @method authenticate
	 * @param {Object} payload
	 * @param {String} payload.token Gaia OAuth access token sent by the client
	 * @param {String} payload.documentName Hocuspocus document name
	 * @returns {Promise<{userId: String, docId: String, projectId: String, canWrite: Boolean}>}
	 * @throws {AccessDenied} When the user may not open the doc
	 * @throws {Error} When Gaia cannot be reached
	 * @private
	 */
	return async function authenticate({ token, documentName }) {
		const docId = parseDocumentName(documentName);
		if (!docId) {
			throw new AccessDenied('unknown document name');
		}
		if (typeof token !== 'string' || token === '') {
			throw new AccessDenied('no token');
		}
		const me = await askGaia(() => gaia.getMe(token), 'token rejected');
		const entities = allowedEntities(me);
		if (!canOpen(entities)) {
			throw new AccessDenied('no doc.get permission');
		}
		const doc = await askGaia(() => gaia.getDoc(token, docId), 'doc not readable');
		const projectId = doc?.data?.attributes?.projectId;
		if (projectId === undefined || projectId === null) {
			throw new AccessDenied('doc has no project');
		}
		return {
			userId: String(me?.data?.id),
			docId,
			projectId: String(projectId),
			canWrite: canWrite(entities, doc)
		};
	};
}

module.exports = { createAuthenticator, AccessDenied };
