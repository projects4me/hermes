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
const SECRET = 'test-secret';
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

async function startServer(t, gaia, timings = FAST, logger = silentLogger(), options = {}) {
	const server = createCollabServer({ gaiaUrl: gaia.url, port: 0, secret: SECRET, timings, logger, ...options });
	await server.listen(0);
	cleanups(t).push(() => server.destroy());
	return server;
}

async function setup(t, timings, logger, options) {
	const gaia = await startStubGaia();
	cleanups(t).push(() => gaia.close());
	gaia.addDoc('doc-1', { projectId: 'project-1' });
	gaia.addDoc('doc-locked', { projectId: 'project-1', locked: true });
	gaia.addUser('writer-a', { id: 'user-a', permissions: WRITER });
	gaia.addUser('writer-b', { id: 'user-b', permissions: WRITER });
	gaia.addUser('reader', { id: 'user-r', permissions: READER });
	const server = await startServer(t, gaia, timings, logger, options);
	return { gaia, server };
}

/**
 * Connects a provider and resolves once it is synced, or rejects when the
 * server refuses it. The provider collects the server's stateless messages
 * in `messages` and its close events in `closes`.
 */
function connect(t, server, token, name = DOC) {
	const messages = [];
	const closes = [];
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
			onStateless: ({ payload }) => messages.push(JSON.parse(payload)),
			onClose: ({ event }) => closes.push({ code: event.code, reason: event.reason }),
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
		provider.messages = messages;
		provider.closes = closes;
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

function notifyAccess(server, docId, reason, secret = SECRET) {
	return fetch(`http://127.0.0.1:${server.address.port}/internal/docs/${docId}/access`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(secret === null ? {} : { 'X-Collab-Secret': secret }) },
		body: JSON.stringify({ reason })
	});
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

test('the access endpoint rejects a missing or wrong secret and changes nothing', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const writer = await connect(t, server, 'writer-a');
	gaia.addDoc('doc-1', { locked: true });

	assert.equal((await notifyAccess(server, 'doc-1', 'locked', null)).status, 401);
	assert.equal((await notifyAccess(server, 'doc-1', 'locked', 'wrong')).status, 401);
	assert.equal((await notifyAccess(server, 'doc-1', 'other')).status, 400);
	const get = await fetch(`http://127.0.0.1:${server.address.port}/internal/docs/doc-1/access`);
	assert.equal(get.status, 405);
	await sleep(200);

	assert.deepEqual(writer.messages, []);
	assert.ok(gaia.requests.filter((request) => request.path === '/api/v1/doc/doc-1').length === 1);
});

test('a lock makes open editors read-only within a second and tells them; an unlock restores editing', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const a = await connect(t, server, 'writer-a');
	const b = await connect(t, server, 'writer-b');
	const reader = await connect(t, server, 'reader');
	gaia.addDoc('doc-1', { locked: true });

	assert.equal((await notifyAccess(server, 'doc-1', 'locked')).status, 202);
	await waitFor(() => a.messages.length > 0 && b.messages.length > 0, 1000);
	assert.deepEqual(a.messages, [{ type: 'access', readOnly: true, reason: 'locked' }]);
	assert.deepEqual(b.messages, [{ type: 'access', readOnly: true, reason: 'locked' }]);
	write(a, 'after lock');
	await sleep(200);
	assert.doesNotMatch(text(b), /after lock/);
	assert.deepEqual(reader.messages, []);

	gaia.addDoc('doc-1', { locked: false });
	assert.equal((await notifyAccess(server, 'doc-1', 'unlocked')).status, 202);
	await waitFor(() => b.messages.length === 2);
	assert.deepEqual(b.messages[1], { type: 'access', readOnly: false, reason: 'unlocked' });
	write(b, 'after unlock');
	await waitFor(() => text(reader).includes('after unlock'));
	await waitFor(() => contentRow(gaia)?.state);
	assert.ok(gaia.writes().every((request) => request.headers.authorization !== 'Bearer reader'));
});

test('a deleted doc closes its connections and tells them', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const writer = await connect(t, server, 'writer-a');
	const reader = await connect(t, server, 'reader');
	gaia.deleteDoc('doc-1');

	assert.equal((await notifyAccess(server, 'doc-1', 'deleted')).status, 202);
	await waitFor(() => writer.closes.length > 0 && reader.closes.length > 0, 1000);

	for (const provider of [writer, reader]) {
		assert.deepEqual(provider.messages, [{ type: 'deleted' }]);
		assert.deepEqual(provider.closes[0], { code: 4401, reason: 'doc deleted' });
	}
});

test('a user who lost access is closed, others stay', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const writer = await connect(t, server, 'writer-a');
	const reader = await connect(t, server, 'reader');
	gaia.addUser('reader', { id: 'user-r', permissions: READER, docIds: [] });

	assert.equal((await notifyAccess(server, 'doc-1', 'access')).status, 202);
	await waitFor(() => reader.closes.length > 0, 1000);

	assert.deepEqual(reader.closes[0], { code: 4401, reason: 'access lost' });
	assert.deepEqual(reader.messages, []);
	await sleep(100);
	assert.deepEqual(writer.closes, []);
	assert.deepEqual(writer.messages, []);
});

test('saves failing past the threshold tell clients the doc is unsaved, then saved once Gaia takes it', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t, { ...FAST, renderIdleMs: 60000, saveRetryMs: [50], unsavedAfterMs: 300 });
	const writer = await connect(t, server, 'writer-a');
	gaia.refuseWrites('writer-a', 500);

	write(writer, 'pending');
	await waitFor(() => writer.messages.some((message) => message.type === 'unsaved'));
	const unsaved = writer.messages.find((message) => message.type === 'unsaved');
	assert.match(unsaved.since, /^\d{4}-\d{2}-\d{2}T/);
	const late = await connect(t, server, 'reader');
	await waitFor(() => late.messages.length > 0);
	assert.deepEqual(late.messages[0], unsaved);

	gaia.allowWrites('writer-a');
	await waitFor(() => writer.messages.some((message) => message.type === 'saved'));
	assert.match(contentRow(gaia).state, /\S/);
	assert.deepEqual(writer.messages.filter((message) => message.type === 'unsaved'), [unsaved]);
});

test('a save that recovers before the threshold sends no message', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t, { ...FAST, renderIdleMs: 60000, saveRetryMs: [50], unsavedAfterMs: 2000 });
	const writer = await connect(t, server, 'writer-a');
	gaia.refuseWrites('writer-a', 500);

	write(writer, 'brief outage');
	await waitFor(() => gaia.writes().length >= 2);
	gaia.allowWrites('writer-a');
	await waitFor(() => contentRow(gaia)?.state);
	await sleep(100);

	assert.deepEqual(writer.messages, []);
});

test('an oversized update closes the connection and is not applied', OPTIONS, async (t) => {
	const { server } = await setup(t, FAST, silentLogger(), { limits: { maxUpdateBytes: 2000 } });
	const sender = await connect(t, server, 'writer-a');
	const other = await connect(t, server, 'writer-b');

	write(sender, 'x'.repeat(5000));
	await waitFor(() => sender.closes.length > 0);

	assert.deepEqual(sender.closes[0], { code: 1009, reason: 'update too large' });
	await sleep(100);
	assert.doesNotMatch(text(other), /xxxx/);
});

test('a connection over the update rate is closed', OPTIONS, async (t) => {
	const { server } = await setup(t, FAST, silentLogger(), { limits: { maxUpdatesPerSecond: 5 } });
	const sender = await connect(t, server, 'writer-a');

	for (let index = 0; index < 20; index += 1) {
		write(sender, `burst ${index}`);
	}
	await waitFor(() => sender.closes.length > 0);

	assert.deepEqual(sender.closes[0], { code: 4429, reason: 'too many updates' });
	// The provider reconnects after 4429; ws cannot close a socket still opening, so let it finish.
	await waitFor(() => sender.configuration.websocketProvider.status === 'connected');
});

test('a browser origin outside the allowed list cannot open a WebSocket', OPTIONS, async (t) => {
	const { server } = await setup(t, FAST, silentLogger(), { allowedOrigins: ['http://app.test'] });
	const url = `ws://127.0.0.1:${server.address.port}`;

	function open(origin) {
		return new Promise((resolve) => {
			const socket = new WebSocket(url, origin === undefined ? {} : { origin });
			socket.on('open', () => {
				socket.close();
				resolve('open');
			});
			socket.on('unexpected-response', (_request, response) => resolve(response.statusCode));
			socket.on('error', () => resolve('error'));
		});
	}

	assert.equal(await open('http://evil.test'), 403);
	assert.equal(await open('http://app.test'), 'open');
	assert.equal(await open(undefined), 'open');
});

test('a lock that Gaia cannot answer makes editors read-only rather than leaving them editable', OPTIONS, async (t) => {
	const logger = silentLogger();
	const { gaia, server } = await setup(t, FAST, logger);
	const writer = await connect(t, server, 'writer-a');
	gaia.outage(500);

	assert.equal((await notifyAccess(server, 'doc-1', 'locked')).status, 202);
	await waitFor(() => writer.messages.length > 0, 1000);
	gaia.outage(null);

	assert.deepEqual(writer.messages, [{ type: 'access', readOnly: true, reason: 'locked' }]);
	assert.ok(logger.errors.some((message) => /doc:doc-1 access not re-checked/.test(message)));
	assert.deepEqual(writer.closes, []);
});

test('a connection that leaves during the re-check is not touched', OPTIONS, async (t) => {
	const { gaia, server } = await setup(t);
	const leaving = await connect(t, server, 'writer-a');
	const staying = await connect(t, server, 'writer-b');
	gaia.addDoc('doc-1', { locked: true });
	gaia.delay(300);

	assert.equal((await notifyAccess(server, 'doc-1', 'locked')).status, 202);
	leaving.close();
	await waitFor(() => staying.messages.length > 0);
	gaia.delay(0);

	assert.deepEqual(leaving.messages, []);
	assert.equal(server.documents.get(DOC).getConnectionsCount(), 1);
});

test('other internal paths are 404 and an oversized body is 413', OPTIONS, async (t) => {
	const { server } = await setup(t);
	const base = `http://127.0.0.1:${server.address.port}`;

	const unknown = await fetch(`${base}/internal/other`, { method: 'POST', headers: { 'X-Collab-Secret': SECRET } });
	assert.equal(unknown.status, 404);
	const large = await fetch(`${base}/internal/docs/doc-1/access`, {
		method: 'POST',
		headers: { 'X-Collab-Secret': SECRET, 'Content-Type': 'application/json' },
		body: JSON.stringify({ reason: 'locked', padding: 'x'.repeat(10000) })
	});
	assert.equal(large.status, 413);
});
