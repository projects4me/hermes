/**
 * Renders the editor fragment of a Y.Doc as html and plain text, the derived
 * copies Gaia keeps next to the Yjs state (Gaia Docs D-002).
 */
const { generateHTML } = require('@tiptap/html');
const { generateText } = require('@tiptap/core');
const { EDITOR_FIELD, editorExtensions } = require('./schema');

const extensions = editorExtensions();

/**
 * This function converts the text of a Y.XmlText to ProseMirror text nodes.
 * Marks are stored as text attributes named after the mark (y-prosemirror
 * adds `--<hash>` to overlapping marks of one type).
 *
 * @method textToJson
 * @param {Y.XmlText} text
 * @returns {Array<Object>}
 * @private
 */
function textToJson(text) {
	const nodes = [];
	for (const part of text.toDelta()) {
		if (typeof part.insert !== 'string' || part.insert === '') {
			continue;
		}
		const node = { type: 'text', text: part.insert };
		const marks = Object.entries(part.attributes || {}).map(([key, attrs]) => {
			const mark = { type: key.split('--')[0] };
			if (attrs && typeof attrs === 'object' && Object.keys(attrs).length > 0) {
				mark.attrs = attrs;
			}
			return mark;
		});
		if (marks.length > 0) {
			node.marks = marks;
		}
		nodes.push(node);
	}
	return nodes;
}

/**
 * This function converts the children of a Y.XmlFragment or Y.XmlElement to
 * ProseMirror JSON nodes.
 *
 * @method childrenToJson
 * @param {Y.XmlFragment|Y.XmlElement} parent
 * @returns {Array<Object>}
 * @private
 */
function childrenToJson(parent) {
	const nodes = [];
	for (const child of parent.toArray()) {
		if (typeof child.toDelta === 'function') {
			nodes.push(...textToJson(child));
			continue;
		}
		const node = { type: child.nodeName };
		const attrs = child.getAttributes();
		if (Object.keys(attrs).length > 0) {
			node.attrs = attrs;
		}
		const content = childrenToJson(child);
		if (content.length > 0) {
			node.content = content;
		}
		nodes.push(node);
	}
	return nodes;
}

/**
 * This function returns the editor content of a Y.Doc as ProseMirror JSON.
 *
 * @method editorJson
 * @param {Y.Doc} ydoc
 * @returns {Object}
 * @public
 */
function editorJson(ydoc) {
	return { type: 'doc', content: childrenToJson(ydoc.getXmlFragment(EDITOR_FIELD)) };
}

/**
 * This function renders the editor content of a Y.Doc.
 *
 * @method renderContent
 * @param {Y.Doc} ydoc
 * @returns {{html: String, plainText: String}}
 * @throws {Error} When the content does not fit the schema
 * @public
 */
function renderContent(ydoc) {
	const json = editorJson(ydoc);
	return {
		html: generateHTML(json, extensions),
		plainText: generateText(json, extensions)
	};
}

module.exports = { editorJson, renderContent };
