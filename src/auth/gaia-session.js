const { sendGaiaRequest } = require('./gaia-http');

/**
 * This function GETs a JSON resource from Gaia.
 *
 * @method requestJson
 * @param {String} url Absolute URL
 * @param {Object} headers Request headers
 * @returns {Promise<Object>} Parsed JSON body
 * @private
 */
function requestJson(url, headers) {
	return sendGaiaRequest({ url, headers, timeoutMs: 4000 });
}

/**
 * This function returns a loader that authenticates a socket token against
 * Gaia GET /api/v1/user/me and loads the user's project memberships.
 *
 * @method createGaiaSessionLoader
 * @param {String} gaiaUrl Gaia origin without a trailing slash
 * @returns {Function} Async function(token) → { userId, projectIds } or null
 * @public
 */
function createGaiaSessionLoader(gaiaUrl) {
	/**
	 * This function loads the user and project memberships for a token.
	 *
	 * @method loadGaiaSession
	 * @param {String} token OAuth access token
	 * @returns {Promise<{userId: String, projectIds: Array<String>}|null>}
	 * @private
	 */
	return async function loadGaiaSession(token) {
		const headers = {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json'
		};
		const me = await requestJson(`${gaiaUrl}/api/v1/user/me`, headers);
		const userId = me?.data?.id;
		if (!userId) {
			return null;
		}

		let projectIds = [];
		try {
			const query = encodeURIComponent(`(Membership.userId : ${userId})`);
			const memberships = await requestJson(
				`${gaiaUrl}/api/v1/membership?query=${query}&limit=-1`,
				headers
			);
			const rows = Array.isArray(memberships?.data) ? memberships.data : [];
			projectIds = rows.map((row) => row.attributes?.projectId).filter(Boolean);
		} catch (_error) {
			const withProjects = await requestJson(`${gaiaUrl}/api/v1/user/me?rels=projects`, headers);
			const related = withProjects.data?.relationships?.projects?.data;
			if (Array.isArray(related)) {
				projectIds = related.map((item) => item.id).filter(Boolean);
			}
		}

		return { userId, projectIds };
	};
}

module.exports = { createGaiaSessionLoader };
