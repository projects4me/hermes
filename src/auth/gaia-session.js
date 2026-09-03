const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * This function GETs a JSON resource from Gaia.
 *
 * @method requestJson
 * @param {String} urlString Absolute URL
 * @param {Object} headers Request headers
 * @returns {Promise<Object>} Parsed JSON body
 * @private
 */
function requestJson(urlString, headers) {
	return new Promise((resolve, reject) => {
		const url = new URL(urlString);
		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request({
			hostname: url.hostname,
			port: url.port,
			path: `${url.pathname}${url.search}`,
			method: 'GET',
			headers,
			timeout: 4000
		}, (res) => {
			let body = '';
			res.on('data', (chunk) => {
				body += chunk;
			});
			res.on('end', () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					return reject(new Error(`gaia ${res.statusCode}`));
				}
				try {
					return resolve(JSON.parse(body));
				} catch (error) {
					return reject(error);
				}
			});
		});
		req.on('error', reject);
		req.on('timeout', () => req.destroy(new Error('gaia timeout')));
		req.end();
	});
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
