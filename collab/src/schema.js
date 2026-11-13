/**
 * The editor schema, matching the Prometheus Docs editor: StarterKit,
 * Underline, Link, tables, task lists and the two suggestion marks. The
 * server uses it only to render the stored Yjs state as html and plain text.
 */
const { Mark, mergeAttributes } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default;
const Underline = require('@tiptap/extension-underline').default;
const Link = require('@tiptap/extension-link').default;
const Table = require('@tiptap/extension-table').default;
const TableRow = require('@tiptap/extension-table-row').default;
const TableHeader = require('@tiptap/extension-table-header').default;
const TableCell = require('@tiptap/extension-table-cell').default;
const TaskList = require('@tiptap/extension-task-list').default;
const TaskItem = require('@tiptap/extension-task-item').default;

/**
 * The Y.XmlFragment of the Y.Doc that holds the editor content (Tiptap's
 * Collaboration default). Other shared types in the Y.Doc are saved with the
 * state but not rendered.
 */
const EDITOR_FIELD = 'default';

const SUGGESTION_ATTRIBUTES = ['id', 'source', 'authorId', 'actedFor', 'requestId', 'reason', 'createdAt'];

/**
 * This function builds a suggestion mark. `id` renders as
 * `data-suggestion-id`, the other attributes as `data-suggestion-<name>`.
 *
 * @method suggestionMark
 * @param {String} name Mark name
 * @param {String} tag HTML tag (`ins` or `del`)
 * @returns {Mark}
 * @private
 */
function suggestionMark(name, tag) {
	return Mark.create({
		name,
		inclusive: false,
		excludes: '',

		addAttributes() {
			const attributes = {};
			for (const attribute of SUGGESTION_ATTRIBUTES) {
				const htmlName = attribute === 'id' ? 'data-suggestion-id' : `data-suggestion-${attribute.toLowerCase()}`;
				attributes[attribute] = {
					default: null,
					parseHTML: (element) => element.getAttribute(htmlName),
					renderHTML: (values) => (values[attribute] === null || values[attribute] === undefined
						? {}
						: { [htmlName]: values[attribute] })
				};
			}
			return attributes;
		},

		parseHTML() {
			return [{ tag: `${tag}[data-suggestion-id]` }];
		},

		renderHTML({ HTMLAttributes }) {
			return [tag, mergeAttributes(HTMLAttributes), 0];
		}
	});
}

const SuggestionInsert = suggestionMark('suggestionInsert', 'ins');
const SuggestionDelete = suggestionMark('suggestionDelete', 'del');

/**
 * This function returns the editor extensions. Collaboration takes over
 * undo history, so StarterKit's history is off, as in the browser editor.
 *
 * @method editorExtensions
 * @returns {Array<Object>}
 * @public
 */
function editorExtensions() {
	return [
		StarterKit.configure({ history: false }),
		Underline,
		Link.configure({ openOnClick: false }),
		Table,
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({ nested: true }),
		SuggestionInsert,
		SuggestionDelete
	];
}

module.exports = { EDITOR_FIELD, SUGGESTION_ATTRIBUTES, editorExtensions };
