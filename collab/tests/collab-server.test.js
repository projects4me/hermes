const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const WebSocket = require('ws');

// The browser provider expects a global Web Crypto, which Node 18 does not have.
globalThis.crypto ??= require('node:crypto').webcrypto;

const { HocuspocusProvider, HocuspocusProviderWebsocket } = require('@hocuspocus/provider');
const { createCollabServer } = require('../src/collab-server');
const { startStubGaia, WRITER, READER } = require('./support/stub-gaia');

const DOC = 'doc:doc-1';
const OPTIONS = { timeout: 10000 };
const FAST = { debounceMs: 50, maxDebounceMs: 200, renderIdleMs: 300, connectionTimeoutMs: 1000, finalSaveRetryMs: [100, 100] };

function silentLogger() {
	const errors = [];
	return { errors, error: (message) => errors.push(message), log() {} };
}

/**
 * Registers cleanups that run last-in first-out after the test: providers
 * leave before the server stops, and the server stops before Gaia does, so
 * the final saves reach Gaia.
 */
function cleanups(t) {
	if (!t.cleanups) {
		t.cleanups = [];
		t.after(async () => {
			for (const cleanup of t.cleanups.reverse()) {
				await cleanup();
			}
		});
	}
	return t.cleanups;
}

async function startServer(t, gaia, timings = FAST, logger = silentLogger()) {
	const server = createCollabServer({ gaiaUrl: gaia.url, port: 0, timings, logger });
	await server.listen(0);
	cleanups(t).push(() => server.destroy());
	return server;
}

async function setup(t, timings, logger) {
	const gaia = await startStubGaia();
	cleanups(t).push(() => gaia.close());
	gaia.addDoc('doc-1', { projectId: 'project-1' });
	gaia.addDoc('doc-locked', { projectId: 'project-1', locked: true });
	gaia.addUser('writer-a', { id: 'user-a', permissions: WRITER });
	gaia.addUser('writer-b', { id: 'user-b', permissions: WRITER });
	gaia.addUser('reader', { id: 'user-r', permissions: READER });
	const server = await startServer(t, gaia, timings, logger);
	return { gaia, server };
}

/**
 * Connects a provider and resolves once it is synced, or rejects when the
 * server refuses it.
 */
function connect(t, server, token, name = DOC) {
	return new Promise((resolve, reject) => {
		const socket = new HocuspocusProviderWebsocket({
			url: `ws://127.0.0.1:${server.address.port}`,
			WebSocketPolyfill: WebSocket,
			quiet: true
		});
		const provider = new HocuspocusProvider({
			websocketProvider: socket,
			name,
			token,
			document: new Y.Doc(),
			quiet: true,
			onSynced: () => resolve(provider),
			onAuthenticationFailed: ({ reason }) => {
				close();
				reject(new Error(`authentication failed: ${reason}`));
			}
		});
		function close() {
			provider.destroy();
			socket.destroy();
		}
		provider.close = close;
		cleanups(t).push(close);
	});
}

function write(provider, text) {
	const fragment = provider.document.getXmlFragment('default');
	const paragraph = new Y.XmlElement('paragraph');
	const xmlText = new Y.XmlText();
	xmlText.insert(0, text);
	paragraph.insert(0, [xmlText]);
	fragment.insert(fragment.length, [paragraph]);
}

function text(provider) {
	return provider.document.getXmlFragment('default').toString();
}

async function waitFor(check, timeoutMs = 3000) {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error('timed out');
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

function contentRow(gaia) {
	return [...gaia.contents.values()][0]?.attributes;
}

test('two writers on doc:<id> converge', OPTIONS, async (t) => {
	const { server } = await setup(t);
	const a = await connect(t, server, 'writer-a');
	const b = await connect(t, server, 'writer-b');

	write(a, 'from a');
	write(b, 'from b');

	await waitFor(() => text(a).includes('from b') && text(b).includes('from a'));
	assert.equal(text(a), text(b));
});

test('unknown tokens, users without doc.get and unreadable docs cannot connect', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	gaia.addUser('no-get', { id: 'user-x', permissions: { 'doc.update': 1 } });

	await assert.rejects(connect(t, server, 'unknown'), /authentication failed/);
	await assert.rejects(connect(t, server, 'no-get'), /authentication failed/);
	await assert.rejects(connect(t, server, 'writer-a', 'doc:missing'), /authentication failed/);
	await assert.rejects(connect(t, server, 'writer-a', 'project:1'), /authentication failed/);
});

test('a reader sees changes but cannot change the document', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const writer = await connect(t, server, 'writer-a');
	const reader = await connect(t, server, 'reader');

	write(writer, 'from writer');
	await waitFor(() => text(reader).includes('from writer'));
	write(reader, 'from reader');
	await new Promise((resolve) => setTimeout(resolve, 200));

	assert.doesNotMatch(text(writer), /from reader/);
	await waitFor(() => contentRow(gaia)?.state);
	assert.ok(gaia.writes().every((request) => request.headers.authorization === 'Bearer writer-a'));
});

test('a locked doc is read-only for a writer', OPTIONS, async (t) => {
	const { server } = await setup(t);
	const first = await connect(t, server, 'writer-a', 'doc:doc-locked');
	const second = await connect(t, server, 'writer-b', 'doc:doc-locked');

	write(first, 'blocked');
	await new Promise((resolve) => setTimeout(resolve, 200));

	assert.doesNotMatch(text(second), /blocked/);
});

test('the content is saved, rendered when idle and reloaded after a restart', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const writer = await connect(t, server, 'writer-a');

	write(writer, 'kept');
	await waitFor(() => contentRow(gaia)?.state);
	assert.equal(contentRow(gaia).html, null);
	await waitFor(() => contentRow(gaia).html === '<p>kept</p>');
	assert.equal(contentRow(gaia).plainText, 'kept');

	writer.close();
	await server.destroy();
	const restarted = await startServer(t, gaia);
	const reader = await connect(t, restarted, 'reader');

	assert.match(text(reader), /kept/);
});

test('the last disconnect writes html and plainText and unloads the doc', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t, { ...FAST, renderIdleMs: 60000 });
	const writer = await connect(t, server, 'writer-a');

	write(writer, 'final words');
	await waitFor(() => contentRow(gaia)?.state);
	assert.equal(contentRow(gaia).html, null);
	writer.close();

	await waitFor(() => contentRow(gaia).plainText === 'final words');
	assert.equal(contentRow(gaia).html, '<p>final words</p>');
	await waitFor(() => server.getDocumentsCount() === 0);
});

test('a Gaia failure keeps the server up and the final save retries until Gaia takes it', OPTIONS, async (t) => {
	const logger = silentLogger();
	const { gaia, server } = await setup(t, { ...FAST, renderIdleMs: 60000, finalSaveRetryMs: [300, 300] }, logger);
	const writer = await connect(t, server, 'writer-a');
	gaia.refuseWrites('writer-a', 500);

	write(writer, 'survives');
	await waitFor(() => logger.errors.some((message) => /not saved \(gaia doccontent create answered 500\)/.test(message)));
	writer.close();
	await new Promise((resolve) => setTimeout(resolve, 100));
	gaia.allowWrites('writer-a');

	await waitFor(() => contentRow(gaia)?.plainText === 'survives');
	await waitFor(() => server.getDocumentsCount() === 0);
	const reader = await connect(t, server, 'reader');
	assert.match(text(reader), /survives/);
});
