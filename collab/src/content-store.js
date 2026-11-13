/**
 * Persistence of the collab server: loads a doc's Yjs state from its Gaia
 * Doccontent row and saves it back with a connected writer's token. Gaia is
 * the only storage (D-022); this module keeps per-doc bookkeeping in memory
 * only while the doc is loaded.
 */
const Y = require('yjs');
const { WriterTokens } = require('./writer-tokens');
const { renderContent } = require('./render');
const { upsertContent } = require('./doccontent-upsert');

const REFUSED_STATUSES = new Set([401, 403]);

/**
 * @class ContentStore
 * @public
 */
class ContentStore {
	/**
	 * @param {Object} options
	 * @param {Object} options.gaia Gaia client (createGaiaClient)
	 * @param {Object} [options.logger] console-like logger
	 */
	constructor({ gaia, logger = console }) {
		this.gaia = gaia;
		this.logger = logger;
		this.docs = new Map();
	}

	/**
	 * This function starts fresh bookkeeping for a doc being loaded, so
	 * nothing is carried over from an earlier load of the same doc.
	 *
	 * @method open
	 * @param {String} documentName
	 * @param {{docId: String, projectId: String}} doc
	 * @public
	 */
	open(documentName, doc) {
		this.docs.delete(documentName);
		return this.register(documentName, doc);
	}

	/**
	 * This function records a doc that a client opened, unless it is known.
	 *
	 * @method register
	 * @param {String} documentName
	 * @param {{docId: String, projectId: String}} doc
	 * @public
	 */
	register(documentName, { docId, projectId }) {
		if (!this.docs.has(documentName)) {
			this.docs.set(documentName, {
				docId,
				projectId,
				contentId: null,
				savedState: null,
				renderedState: null,
				writers: new WriterTokens(),
				queue: Promise.resolve()
			});
		}
		return this.docs.get(documentName);
	}

	/**
	 * @method has
	 * @param {String} documentName
	 * @returns {Boolean}
	 * @public
	 */
	has(documentName) {
		return this.docs.has(documentName);
	}

	/**
	 * @method addWriter
	 * @param {String} documentName
	 * @param {String} socketId
	 * @param {String} token
	 * @public
	 */
	addWriter(documentName, socketId, token) {
		this.docs.get(documentName)?.writers.add(socketId, token);
	}

	/**
	 * @method leave
	 * @param {String} documentName
	 * @param {String} socketId
	 * @public
	 */
	leave(documentName, socketId) {
		this.docs.get(documentName)?.writers.leave(socketId);
	}

	/**
	 * This function drops the bookkeeping of an unloaded doc.
	 *
	 * @method forget
	 * @param {String} documentName
	 * @public
	 */
	forget(documentName) {
		this.docs.delete(documentName);
	}

	/**
	 * This function reads the stored Yjs state of a doc.
	 *
	 * @method load
	 * @param {String} documentName A registered doc
	 * @param {String} token Token of the user opening the doc
	 * @returns {Promise<Uint8Array|null>} The state, or null when the doc has none yet
	 * @public
	 */
	async load(documentName, token) {
		const entry = this.docs.get(documentName);
		const content = await this.gaia.findContent(token, entry.docId);
		if (!content) {
			return null;
		}
		entry.contentId = content.id;
		entry.savedState = content.state;
		entry.renderedState = content.html === null ? null : content.state;
		return content.state ? new Uint8Array(Buffer.from(content.state, 'base64')) : null;
	}

	/**
	 * This function saves a doc's state, and its html and plain text when
	 * `render` is set. Saves of one doc run one after the other; a save that
	 * would write nothing new is skipped.
	 *
	 * @method save
	 * @param {String} documentName
	 * @param {Y.Doc} ydoc
	 * @param {Object} [options]
	 * @param {Boolean} [options.render] Also write html and plainText
	 * @returns {Promise<Boolean>} Whether Gaia has the doc's current state afterwards
	 * @public
	 */
	save(documentName, ydoc, { render = false } = {}) {
		const entry = this.docs.get(documentName);
		if (!entry) {
			return Promise.resolve(false);
		}
		const run = entry.queue.then(() => this.write(entry, ydoc, render));
		entry.queue = run.catch(() => null);
		return run;
	}

	/**
	 * @method write
	 * @param {Object} entry
	 * @param {Y.Doc} ydoc
	 * @param {Boolean} render
	 * @returns {Promise<Boolean>}
	 * @private
	 */
	async write(entry, ydoc, render) {
		const state = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64');
		const stateChanged = state !== entry.savedState;
		const renderChanged = render && state !== entry.renderedState;
		if (!stateChanged && !renderChanged) {
			return true;
		}
		const attributes = { state, byteSize: state.length };
		if (renderChanged) {
			Object.assign(attributes, this.rendered(entry, ydoc));
		}
		if (!(await this.writeWithAnyWriter(entry, attributes))) {
			return false;
		}
		entry.savedState = state;
		if (attributes.html !== undefined) {
			entry.renderedState = state;
		}
		return true;
	}

	/**
	 * @method rendered
	 * @param {Object} entry
	 * @param {Y.Doc} ydoc
	 * @returns {Object} `{html, plainText}`, or `{}` when the content does not fit the schema
	 * @private
	 */
	rendered(entry, ydoc) {
		try {
			return renderContent(ydoc);
		} catch (error) {
			this.logger.error(`collab: doc ${entry.docId} not rendered (${error.name})`);
			return {};
		}
	}

	/**
	 * This function writes with the first writer token Gaia accepts; a token
	 * refused with 401 or 403 is dropped and the next one tried.
	 *
	 * @method writeWithAnyWriter
	 * @param {Object} entry
	 * @param {Object} attributes
	 * @returns {Promise<Boolean>} False when no writer token was accepted
	 * @private
	 */
	async writeWithAnyWriter(entry, attributes) {
		for (const token of entry.writers.ordered()) {
			try {
				entry.contentId = await upsertContent(this.gaia, token, entry, attributes);
				return true;
			} catch (error) {
				if (!REFUSED_STATUSES.has(error.status)) {
					throw error;
				}
				entry.writers.drop(token);
			}
		}
		this.logger.error(`collab: doc ${entry.docId} not saved, no writer token was accepted`);
		return false;
	}
}

module.exports = { ContentStore };
