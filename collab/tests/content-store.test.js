const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { ContentStore } = require('../src/content-store');
const { createGaiaClient } = require('../src/gaia-client');
const { renderContent } = require('../src/render');
const { startStubGaia, WRITER } = require('./support/stub-gaia');

const DOC = 'doc:doc-1';

function silentLogger() {
	const errors = [];
	return { errors, error: (message) => errors.push(message), log() {} };
}

async function setup(t) {
	const gaia = await startStubGaia();
	t.after(() => gaia.close());
	gaia.addDoc('doc-1', { projectId: 'project-1' });
	gaia.addUser('writer-a', { id: 'user-a', permissions: WRITER });
	gaia.addUser('writer-b', { id: 'user-b', permissions: WRITER });
	const logger = silentLogger();
	const store = new ContentStore({ gaia: createGaiaClient({ gaiaUrl: gaia.url }), logger });
	store.register(DOC, { docId: 'doc-1', projectId: 'project-1' });
	return { gaia, store, logger };
}

function paragraph(text, attributes) {
	const element = new Y.XmlElement('paragraph');
	const xmlText = new Y.XmlText();
	xmlText.insert(0, text, attributes);
	element.insert(0, [xmlText]);
	return element;
}

function editorDoc(...paragraphs) {
	const ydoc = new Y.Doc();
	ydoc.getXmlFragment('default').insert(0, paragraphs);
	return ydoc;
}

function base64(ydoc) {
	return Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64');
}

test('load returns the stored state, which rebuilds the document', async (t) => {
	const { gaia, store } = await setup(t);
	const original = editorDoc(paragraph('Stored text'));
	gaia.addContent({ docId: 'doc-1', projectId: 'project-1', state: base64(original), html: '<p>Stored text</p>' });

	const state = await store.load(DOC, 'writer-a');
	const loaded = new Y.Doc();
	Y.applyUpdate(loaded, state);

	assert.equal(renderContent(loaded).plainText, 'Stored text');
});

test('load returns null for a doc without content', async (t) => {
	const { store } = await setup(t);

	assert.equal(await store.load(DOC, 'writer-a'), null);
});

test('the first save creates the content, later saves update it', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	await store.load(DOC, 'writer-a');
	const ydoc = editorDoc(paragraph('One'));

	assert.equal(await store.save(DOC, ydoc), true);
	ydoc.getXmlFragment('default').insert(1, [paragraph('Two')]);
	assert.equal(await store.save(DOC, ydoc), true);

	const writes = gaia.writes();
	assert.deepEqual(writes.map((request) => `${request.method} ${request.path}`), [
		'POST /api/v1/doccontent',
		'PATCH /api/v1/doccontent/content-1'
	]);
	assert.deepEqual(Object.keys(writes[0].body.data.attributes).sort(), ['byteSize', 'docId', 'projectId', 'state']);
	assert.deepEqual(Object.keys(writes[1].body.data.attributes).sort(), ['byteSize', 'state']);
	const row = gaia.contents.get('content-1').attributes;
	assert.equal(row.state, base64(ydoc));
	assert.equal(row.byteSize, row.state.length);
	assert.equal(row.html, null);
	assert.ok(writes.every((request) => request.headers.authorization === 'Bearer writer-a'));
});

test('a save with nothing new writes nothing', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	const ydoc = editorDoc(paragraph('One'));

	await store.save(DOC, ydoc, { render: true });
	await store.save(DOC, ydoc);
	await store.save(DOC, ydoc, { render: true });

	assert.equal(gaia.writes().length, 1);
});

test('a render save writes html and plainText from the editor fragment only', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	const ydoc = editorDoc(
		paragraph('Bold', { bold: {} }),
		paragraph('Added', { suggestionInsert: { id: 's-1', source: 'agent', authorId: 'user-a', reason: 'clarity' } })
	);
	ydoc.getMap('notes').set('note-1', 'a review note that must not be rendered');

	await store.save(DOC, ydoc);
	await store.save(DOC, ydoc, { render: true });

	const row = gaia.contents.get('content-1').attributes;
	assert.equal(row.html, '<p><strong>Bold</strong></p><p><ins data-suggestion-id="s-1" data-suggestion-source="agent" data-suggestion-authorid="user-a" data-suggestion-reason="clarity">Added</ins></p>');
	assert.equal(row.plainText, 'Bold\n\nAdded');
	assert.equal(row.state, base64(ydoc));
	assert.doesNotMatch(row.html, /review note/);
});

test('a writer token Gaia refuses is skipped for the next writer', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-b', 'writer-b');
	store.addWriter(DOC, 'socket-a', 'writer-a');
	gaia.refuseWrites('writer-a', 401);

	assert.equal(await store.save(DOC, editorDoc(paragraph('One'))), true);

	assert.deepEqual(gaia.writes().map((request) => request.headers.authorization), ['Bearer writer-a', 'Bearer writer-b']);
	assert.equal(gaia.contents.size, 1);
});

test('a writer who left still saves the last changes', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	store.leave(DOC, 'socket-a');

	assert.equal(await store.save(DOC, editorDoc(paragraph('One')), { render: true }), true);

	assert.equal(gaia.contents.get('content-1').attributes.plainText, 'One');
});

test('without an accepted writer token nothing is saved and the failure is logged', async (t) => {
	const { gaia, store, logger } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	gaia.refuseWrites('writer-a', 403);

	assert.equal(await store.save(DOC, editorDoc(paragraph('One'))), false);
	assert.equal(await store.save(DOC, editorDoc(paragraph('One'))), false);

	assert.equal(gaia.contents.size, 0);
	assert.equal(gaia.writes().length, 1);
	assert.match(logger.errors[0], /doc-1 not saved/);
	assert.doesNotMatch(logger.errors.join('\n'), /writer-a/);
});

test('content another writer created first is looked up and updated', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	gaia.addContent({ docId: 'doc-1', projectId: 'project-1', state: 'AAA=' });
	const ydoc = editorDoc(paragraph('Mine'));

	assert.equal(await store.save(DOC, ydoc), true);

	assert.deepEqual(gaia.writes().map((request) => `${request.method} ${request.path}`), [
		'POST /api/v1/doccontent',
		'PATCH /api/v1/doccontent/content-1'
	]);
	assert.equal(gaia.contents.get('content-1').attributes.state, base64(ydoc));
});

test('content whose row is gone (404) is created again', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	const ydoc = editorDoc(paragraph('One'));
	await store.save(DOC, ydoc);
	gaia.deleteContent('content-1');

	ydoc.getXmlFragment('default').insert(1, [paragraph('Two')]);
	assert.equal(await store.save(DOC, ydoc), true);

	assert.deepEqual(gaia.writes().map((request) => `${request.method} ${request.path}`), [
		'POST /api/v1/doccontent',
		'PATCH /api/v1/doccontent/content-1',
		'POST /api/v1/doccontent'
	]);
	assert.equal(gaia.contents.get('content-2').attributes.state, base64(ydoc));
});

test('a Gaia error other than a refused token fails the save and a later save retries it', async (t) => {
	const { gaia, store } = await setup(t);
	store.addWriter(DOC, 'socket-a', 'writer-a');
	gaia.refuseWrites('writer-a', 500);
	const ydoc = editorDoc(paragraph('One'));

	await assert.rejects(store.save(DOC, ydoc), /answered 500/);
	gaia.allowWrites('writer-a');

	assert.equal(await store.save(DOC, ydoc), true);
	assert.equal(gaia.contents.get('content-1').attributes.state, base64(ydoc));
});
