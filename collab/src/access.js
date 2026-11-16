/**
 * Access rules of the collab server: who may open a doc and who may change
 * it, decided from Gaia's answers only.
 */

const DOCUMENT_NAME = /^doc:([A-Za-z0-9-]{1,64})$/;
const ALLOWED_VALUES = new Set([1, 2, '1', '2', true]);
const TRUE_VALUES = new Set([true, 1, '1', 't', 'true']);

/**
 * This function reads the doc id from a Hocuspocus document name `doc:<docId>`.
 *
 * @method parseDocumentName
 * @param {String} documentName
 * @returns {String|null} The doc id, or null for any other name
 * @public
 */
function parseDocumentName(documentName) {
	const match = typeof documentName === 'string' ? DOCUMENT_NAME.exec(documentName) : null;
	return match ? match[1] : null;
}

/**
 * This function returns the ACL entities the user is allowed, from the
 * `aclPermissions` included in `GET /api/v1/user/me`. 1 means allowed,
 * 2 allowed for members (as in Prometheus' acl service).
 *
 * @method allowedEntities
 * @param {Object} me JSON:API body of `GET /api/v1/user/me?include=aclPermissions`
 * @returns {Set<String>}
 * @public
 */
function allowedEntities(me) {
	const included = Array.isArray(me?.included) ? me.included : [];
	const allowed = new Set();
	for (const item of included) {
		const entity = item?.attributes?.entity;
		if (typeof entity === 'string' && ALLOWED_VALUES.has(item.attributes.allowed)) {
			allowed.add(entity);
		}
	}
	return allowed;
}

/**
 * This function decides whether the user may open the doc. Without a
 * `doc.get` permission the connection is refused.
 *
 * @method canOpen
 * @param {Set<String>} entities From allowedEntities()
 * @returns {Boolean}
 * @public
 */
function canOpen(entities) {
	return entities.has('doc.get');
}

/**
 * This function decides whether the user may change the doc: they need
 * `doc.update` and the doc must not be locked. Otherwise the connection is
 * read-only.
 *
 * @method canWrite
 * @param {Set<String>} entities From allowedEntities()
 * @param {Object} doc JSON:API body of `GET /api/v1/doc/{id}`
 * @returns {Boolean}
 * @public
 */
function canWrite(entities, doc) {
	return entities.has('doc.update') && !TRUE_VALUES.has(doc?.data?.attributes?.locked);
}

module.exports = { parseDocumentName, allowedEntities, canOpen, canWrite };
