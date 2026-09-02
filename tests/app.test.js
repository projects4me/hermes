const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createHermesApp } = require('../src/app');

const config = {
	port: 0,
	hermesSecret: 'test-secret',
	gaiaUrl: 'http://unused.test',
	corsOrigin: '*',
	authCacheTtlMs: 1000,
	authCacheMaxEntries: 10
};

function once(socket, eventName, timeoutMs = 1000) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`timed out waiting for ${eventName}`)),
			timeoutMs
		);
		socket.once(eventName, (payload) => {
			clearTimeout(timeout);
			resolve(payload);
		});
	});
}

test('intents receive only matching validated domain events', async (t) => {
	const hermes = createHermesApp({
		config,
		loadSession: async (token) => token === 'valid'
			? { userId: 'user-1', projectIds: ['project-1'] }
			: null,
		logger: { info() {}, error() {} }
	});
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	const port = hermes.httpServer.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;
	const client = createClient(baseUrl, {
		auth: { token: 'valid' },
		transports: ['websocket']
	});
	t.after(() => {
		client.close();
		hermes.io.close();
	});
	await once(client, 'connect');

	const ack = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [
			{ projectId: 'project-1', eventName: 'issue.created' },
			{ projectId: 'project-2', eventName: 'issue.created' }
		]
	});
	assert.equal(ack.revision, 0);
	assert.equal(ack.accepted.length, 1);
	assert.equal(ack.rejected[0].reason, 'project_not_authorized');

	const envelope = {
		schemaVersion: 1,
		eventId: 'event-1',
		eventName: 'issue.created',
		occurredAt: '2026-08-20T10:00:00Z',
		projectId: 'project-1',
		resource: { type: 'issue', id: 'issue-1' },
		actorId: null,
		changes: { status: 'open' }
	};
	const domainEvent = once(client, 'domain:event');
	const response = await fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hermes-secret': 'test-secret'
		},
		body: JSON.stringify(envelope)
	});
	assert.equal(response.status, 200);
	const published = await response.json();
	assert.equal(published.ok, true);
	assert.equal(published.eventId, envelope.eventId);
	assert.equal(published.subscribers, 1);
	assert.match(published.room, /^v1:intent:/);
	assert.deepEqual(await domainEvent, envelope);

	const invalid = await fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hermes-secret': 'test-secret'
		},
		body: JSON.stringify({ ...envelope, eventName: 'issue.deleted' })
	});
	assert.equal(invalid.status, 400);

	const health = await fetch(`${baseUrl}/health`).then((result) => result.json());
	assert.equal(health.counters.publish.accepted, 1);
	assert.equal(health.counters.publish.rejected, 1);
	assert.equal(health.counters.publish.zeroSubscribers, 0);
	assert.equal(health.counters.intents.accepted, 1);
});

test('legacy ingest paths are gone', async (t) => {
	const hermes = createHermesApp({
		config,
		loadSession: async () => ({ userId: 'user-1', projectIds: ['project-1'] }),
		logger: { info() {}, error() {} }
	});
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	const port = hermes.httpServer.address().port;
	const baseUrl = `http://127.0.0.1:${port}`;
	t.after(() => {
		hermes.io.close();
	});

	const events = await fetch(`${baseUrl}/events`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hermes-secret': 'test-secret'
		},
		body: JSON.stringify({ rooms: ['/app/project/1/live'], payload: {} })
	});
	const broadcast = await fetch(`${baseUrl}/broadcast`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hermes-secret': 'test-secret'
		},
		body: JSON.stringify({ rooms: ['/app/project/1/live'], payload: {} })
	});
	assert.equal(events.status, 404);
	assert.equal(broadcast.status, 404);
});

function createTestHermes(t, loadSession) {
	const hermes = createHermesApp({
		config,
		loadSession,
		logger: { info() {}, error() {} }
	});
	t.after(() => hermes.io.close());
	return hermes;
}

async function listen(hermes) {
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	const port = hermes.httpServer.address().port;
	return { port, baseUrl: `http://127.0.0.1:${port}` };
}

async function connectClient(t, baseUrl, token) {
	const client = createClient(baseUrl, {
		auth: { token },
		transports: ['websocket']
	});
	t.after(() => client.close());
	await once(client, 'connect');
	return client;
}

function envelope(overrides = {}) {
	return {
		schemaVersion: 1,
		eventId: 'event-1',
		eventName: 'issue.status.changed',
		occurredAt: '2026-08-20T10:00:00Z',
		projectId: 'project-1',
		resource: { type: 'issue', id: 'issue-1' },
		actorId: null,
		changes: { status: 'done' },
		...overrides
	};
}

async function postEvent(baseUrl, body) {
	return fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-hermes-secret': 'test-secret'
		},
		body: JSON.stringify(body)
	});
}

test('publish reports zero subscribers before intents and increments counter', async (t) => {
	const warnings = [];
	const hermes = createHermesApp({
		config,
		loadSession: async () => ({ userId: 'user-1', projectIds: ['project-1'] }),
		logger: {
			info() {},
			warn(...args) {
				warnings.push(args);
			},
			error() {}
		}
	});
	t.after(() => hermes.io.close());
	const { baseUrl } = await listen(hermes);

	const empty = await postEvent(baseUrl, envelope({ eventId: 'no-listeners' }));
	assert.equal(empty.status, 200);
	const emptyBody = await empty.json();
	assert.equal(emptyBody.subscribers, 0);
	assert.equal(emptyBody.ok, true);
	assert.match(emptyBody.room, /issue\.status\.changed$/);

	const healthAfterEmpty = await fetch(`${baseUrl}/health`).then((result) => result.json());
	assert.equal(healthAfterEmpty.counters.publish.zeroSubscribers, 1);
	assert.equal(healthAfterEmpty.counters.publish.accepted, 1);
	assert.ok(warnings.some((entry) => String(entry[0]).includes('zero subscribers')));

	const client = await connectClient(t, baseUrl, 'valid');
	await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.status.changed' }]
	});

	const withListener = await postEvent(
		baseUrl,
		envelope({ eventId: 'with-listener' })
	);
	assert.equal(withListener.status, 200);
	const withBody = await withListener.json();
	assert.equal(withBody.subscribers, 1);

	const healthAfterJoin = await fetch(`${baseUrl}/health`).then((result) => result.json());
	assert.equal(healthAfterJoin.counters.publish.zeroSubscribers, 1);
	assert.equal(healthAfterJoin.counters.publish.accepted, 2);
});

test('two sockets for one user receive only their registered events', async (t) => {
	const hermes = createTestHermes(t, async () => ({
		userId: 'user-1',
		projectIds: ['project-1']
	}));
	const { baseUrl } = await listen(hermes);
	const board = await connectClient(t, baseUrl, 'valid');
	const threads = await connectClient(t, baseUrl, 'valid');
	const boardEvents = [];
	const threadEvents = [];
	board.on('domain:event', (event) => boardEvents.push(event.eventName));
	threads.on('domain:event', (event) => threadEvents.push(event.eventName));

	await board.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.status.changed' }]
	});
	await threads.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'conversation.created' }]
	});

	await postEvent(baseUrl, envelope());
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(boardEvents, ['issue.status.changed']);
	assert.deepEqual(threadEvents, []);

	await postEvent(baseUrl, envelope({
		eventId: 'event-2',
		eventName: 'conversation.created',
		resource: { type: 'conversationroom', id: 'room-1' },
		changes: { subject: 'Hello' }
	}));
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(threadEvents, ['conversation.created']);
	assert.deepEqual(boardEvents, ['issue.status.changed']);
});

test('reconnecting sockets start with a clean revision and can resubscribe', async (t) => {
	const hermes = createTestHermes(t, async () => ({
		userId: 'user-1',
		projectIds: ['project-1']
	}));
	const { baseUrl } = await listen(hermes);
	const client = await connectClient(t, baseUrl, 'valid');

	const first = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.created' }]
	});
	assert.equal(first.accepted.length, 1);

	const stale = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: []
	});
	assert.equal(stale.rejected[0].reason, 'stale_revision');

	const disconnected = once(client, 'disconnect', 3000);
	client.disconnect();
	await disconnected;
	client.connect();
	await once(client, 'connect');

	const resubscribed = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.created' }]
	});
	assert.equal(resubscribed.accepted.length, 1);

	const domainEvent = once(client, 'domain:event');
	await postEvent(baseUrl, envelope({
		eventName: 'issue.created',
		resource: { type: 'issue', id: 'issue-9' }
	}));
	assert.equal((await domainEvent).eventName, 'issue.created');
});

test('disconnected sockets stop receiving intent events', async (t) => {
	const hermes = createTestHermes(t, async () => ({
		userId: 'user-1',
		projectIds: ['project-1']
	}));
	const { baseUrl } = await listen(hermes);
	const staying = await connectClient(t, baseUrl, 'valid');
	const leaving = await connectClient(t, baseUrl, 'valid');

	await staying.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.status.changed' }]
	});
	await leaving.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.status.changed' }]
	});

	const left = once(leaving, 'disconnect', 3000);
	leaving.close();
	await left;

	const stayingEvent = once(staying, 'domain:event');
	await postEvent(baseUrl, envelope({ eventId: 'after-disconnect' }));
	assert.equal((await stayingEvent).eventId, 'after-disconnect');
});

test('notification.created is delivered only to the matching user socket', async (t) => {
	const hermes = createTestHermes(t, async (token) => {
		if (token === 'user-a') return { userId: 'user-1', projectIds: [] };
		if (token === 'user-b') return { userId: 'user-2', projectIds: [] };
		return null;
	});
	const { baseUrl } = await listen(hermes);
	const socketA = await connectClient(t, baseUrl, 'user-a');
	const socketB = await connectClient(t, baseUrl, 'user-b');

	const ackA = await socketA.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'user:user-1', eventName: 'notification.created' }]
	});
	assert.equal(ackA.accepted.length, 1);
	assert.equal(ackA.rejected.length, 0);

	const ackB = await socketB.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'user:user-2', eventName: 'notification.created' }]
	});
	assert.equal(ackB.accepted.length, 1);

	const notifEnvelope = {
		schemaVersion: 1,
		eventId: 'notif-1',
		eventName: 'notification.created',
		occurredAt: '2026-08-20T10:00:00Z',
		projectId: 'user:user-1',
		resource: { type: 'systemnotification', id: 'sn-1' },
		actorId: null,
		changes: { message: 'You have a new notification' },
		meta: { recipientId: 'snr-1', recipientUserId: 'user-1' }
	};

	const aEvent = once(socketA, 'domain:event');
	const response = await postEvent(baseUrl, notifEnvelope);
	assert.equal(response.status, 200);
	const received = await aEvent;
	assert.equal(received.eventId, 'notif-1');
	assert.equal(received.eventName, 'notification.created');

	// socketB must not receive the event (it's for user-1, not user-2)
	await new Promise((resolve) => setTimeout(resolve, 50));
	const bEvents = [];
	socketB.on('domain:event', (event) => bEvents.push(event.eventId));
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.deepEqual(bEvents, []);
});

test('notification.created intent rejected when scope is another user', async (t) => {
	const hermes = createTestHermes(t, async () => ({ userId: 'user-1', projectIds: [] }));
	const { baseUrl } = await listen(hermes);
	const client = await connectClient(t, baseUrl, 'valid');

	const ack = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'user:user-2', eventName: 'notification.created' }]
	});
	assert.equal(ack.accepted.length, 0);
	assert.equal(ack.rejected.length, 1);
	assert.equal(ack.rejected[0].reason, 'project_not_authorized');
});

