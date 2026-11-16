/**
 * Handler of `POST /internal/docs/:docId/access` (D-023): Gaia tells the
 * collab server, with the shared secret in `X-Collab-Secret`, that a doc's
 * access changed.
 */
const crypto = require('crypto');
const { reply } = require('./reply');

const REASONS = new Set(['locked', 'unlocked', 'deleted', 'access']);
const MAX_BODY_BYTES = 4096;

/**
 * This function compares the sent secret with the configured one in
 * constant time: both are hashed first, so their lengths never matter.
 *
 * @method secretMatches
 * @param {String} expected Configured secret
 * @param {String|undefined} sent Header value
 * @returns {Boolean}
 * @private
 */
function secretMatches(expected, sent) {
	if (typeof sent !== 'string' || sent === '') {
		return false;
	}
	const digest = (value) => crypto.createHash('sha256').update(value).digest();
	return crypto.timingSafeEqual(digest(expected), digest(sent));
}

/**
 * This function reads a small JSON body. A body over MAX_BODY_BYTES is not
 * read further.
 *
 * @method readJson
 * @param {IncomingMessage} request
 * @returns {Promise<{body: Object|null, tooLarge: Boolean}>} body is null when it is not a JSON object
 * @private
 */
function readJson(request) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		request.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				request.removeAllListeners('data');
				request.pause();
				return resolve({ body: null, tooLarge: true });
			}
			chunks.push(chunk);
		});
		request.on('end', () => {
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				resolve({ body: body !== null && typeof body === 'object' ? body : null, tooLarge: false });
			} catch (_error) {
				resolve({ body: null, tooLarge: false });
			}
		});
		request.on('error', () => resolve({ body: null, tooLarge: false }));
	});
}

/**
 * This function returns the access-change handler.
 *
 * @method createAccessChangeHandler
 * @param {Object} options
 * @param {String} options.secret Shared secret (COLLAB_SECRET)
 * @param {Function} options.onAccessChange function(docId, reason), started without waiting for it
 * @returns {Function} Async function(request, response, params) with `params.docId` from the path
 * @public
 */
function createAccessChangeHandler({ secret, onAccessChange }) {
	if (typeof secret !== 'string' || secret === '') {
		throw new Error('the access-change route needs a secret');
	}

	return async function accessChange(request, response, { docId }) {
		if (!secretMatches(secret, request.headers['x-collab-secret'])) {
			request.resume();
			return reply(response, 401, { error: 'unauthorized' });
		}
		const { body, tooLarge } = await readJson(request);
		if (tooLarge) {
			return reply(response, 413, { error: 'body too large' }, { Connection: 'close' });
		}
		if (!body || !REASONS.has(body.reason)) {
			return reply(response, 400, { error: 'reason must be locked, unlocked, deleted or access' });
		}
		onAccessChange(docId, body.reason);
		return reply(response, 202);
	};
}

module.exports = { createAccessChangeHandler };
