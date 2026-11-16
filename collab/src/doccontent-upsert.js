/**
 * The write protocol for a doc's one Doccontent row (Gaia Docs D-004):
 * update it when its id is known, otherwise create it. A create refused as a
 * duplicate (422, another writer was first) finds the row and updates it; an
 * update of a row that is gone (404) creates it again.
 */

const DUPLICATE_STATUS = 422;
const GONE_STATUS = 404;

/**
 * This function finds the doc's row after a refused create and returns its id.
 *
 * @method existingContentId
 * @param {Object} gaia Gaia client
 * @param {String} token
 * @param {String} docId
 * @param {Error} createError The 422 from the create
 * @returns {Promise<String>}
 * @throws {Error} The create error, when no row is found
 * @private
 */
async function existingContentId(gaia, token, docId, createError) {
	const existing = await gaia.findContent(token, docId);
	if (!existing) {
		throw createError;
	}
	return existing.id;
}

/**
 * This function writes the attributes to the doc's Doccontent row.
 *
 * @method upsertContent
 * @param {Object} gaia Gaia client (createGaiaClient)
 * @param {String} token Writer's token
 * @param {{docId: String, projectId: String, contentId: String|null}} target
 * @param {Object} attributes `state`, `byteSize` and optionally `html`, `plainText`
 * @returns {Promise<String>} The row's id
 * @public
 */
async function upsertContent(gaia, token, { docId, projectId, contentId }, attributes) {
	if (contentId !== null) {
		try {
			await gaia.updateContent(token, contentId, attributes);
			return contentId;
		} catch (error) {
			if (error.status !== GONE_STATUS) {
				throw error;
			}
		}
	}
	let id;
	try {
		return await gaia.createContent(token, { docId, projectId, ...attributes });
	} catch (error) {
		if (error.status !== DUPLICATE_STATUS) {
			throw error;
		}
		id = await existingContentId(gaia, token, docId, error);
	}
	await gaia.updateContent(token, id, attributes);
	return id;
}

module.exports = { upsertContent };
