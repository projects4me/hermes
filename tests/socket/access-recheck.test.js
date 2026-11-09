const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createHermesApp } = require('../../src/app');
const { startStubGaia } = require('../support/stub-gaia');
const { activeAnswer } = require('../support/introspection');

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * Hermes on a stub Gaia (D-015). `serviceToken.value` can be cleared to make
 * introspection fail.
 */
async function startHermes(t) {
	const gaia = await startStubGaia();
	gaia.issueServiceToken('svc-1');
	const serviceToken = { value: 'svc-1' };
	const hermes = createHermesApp({
		config: {
			port: 0,
			hermesSecret: 'test-secret',
			gaiaUrl: gaia.url,
			corsOrigin: '*',
			authCacheTtlMs: 60000,
			authCacheMaxEntries: 10
		},
		getServiceToken: () => serviceToken.value,
		logger: silentLogger
	});
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	const baseUrl = `http://127.0.0.1:${hermes.httpServer.address().port}`;
	t.after(async () => {
		hermes.io.close();
		await gaia.close();
	});
	return { gaia, hermes, baseUrl, serviceToken };
}

function connect(t, baseUrl, token) {
	const client = createClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
	t.after(() => client.close());
	return new Promise((resolve, reject) => {
		client.once('connect', () => resolve(client));
		client.once('connect_error', (error) => reject(error));
	});
}

let eventCount = 0;

async function publish(baseUrl, eventName, projectId) {
	eventCount += 1;
	const response = await fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Hermes-Secret': 'test-secret' },
		body: JSON.stringify({
			schemaVersion: 1,
			eventId: `evt-${eventCount}`,
			eventName,
			occurredAt: '2026-11-09T07:00:00Z',
			projectId,
			resource: { type: 'user', id: 'user-1' },
			actorId: null,
			changes: {}
		})
	});
	assert.equal(response.status, 200);
	return response.json();
}

async function until(condition, timeoutMs = 2000) {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > timeoutMs) {
			throw new Error('condition not met in time');
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function introspectionCalls(gaia, token) {
	return gaia.requests.filter((request) => request.path === '/api/v1/introspect'
		&& new URLSearchParams(request.body).get('token') === token).length;
}

/**
 * Collects domain:event names the client receives, as `projectId eventName`.
 */
function received(client) {
	const events = [];
	client.on('domain:event', (event) => events.push(`${event.projectId} ${event.eventName}`));
	return events;
}

async function subscribe(client, intents, revision = 0) {
	const ack = await client.emitWithAck('intents:set', { protocolVersion: 1, revision, intents });
	assert.equal(ack.rejected.length, 0);
	return ack;
}

const TWO_PROJECTS = [
	{ projectId: 'project-1', eventName: 'issue.created' },
	{ projectId: 'project-2', eventName: 'issue.created' },
	{ projectId: 'user:user-1', eventName: 'user.access.changed' }
];

test('a membership removal makes the socket leave the removed project rooms', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer({ projectIds: ['project-1', 'project-2'] }));
	const client = await connect(t, baseUrl, 'user-token');
	const events = received(client);
	await subscribe(client, TWO_PROJECTS);

	gaia.introspects('user-token', activeAnswer({ projectIds: ['project-1'] }));
	await publish(baseUrl, 'user.access.changed', 'user:user-1');
	await until(() => hermes.counters.access.socketsRechecked === 1);

	assert.equal(introspectionCalls(gaia, 'user-token'), 2);
	assert.equal(hermes.counters.access.intentsDropped, 1);
	assert.equal(client.connected, true);

	await publish(baseUrl, 'issue.created', 'project-2');
	await publish(baseUrl, 'issue.created', 'project-1');
	await until(() => events.includes('project-1 issue.created'));
	assert.deepEqual(events, ['user:user-1 user.access.changed', 'project-1 issue.created']);

	// The next snapshot is checked against the new access.
	const ack = await client.emitWithAck('intents:set', { protocolVersion: 1, revision: 1, intents: TWO_PROJECTS });
	assert.deepEqual(ack.rejected.map((rejection) => rejection.projectId), ['project-2']);
});

test('a disabled user is disconnected and their cached session evicted', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer());
	const client = await connect(t, baseUrl, 'user-token');
	await subscribe(client, [{ projectId: 'project-1', eventName: 'issue.created' }]);
	assert.equal(hermes.sessionCache.size, 1);

	gaia.introspects('user-token', { active: false });
	const disconnected = new Promise((resolve) => client.once('disconnect', resolve));
	await publish(baseUrl, 'user.access.changed', 'user:user-1');

	assert.equal(await disconnected, 'io server disconnect');
	assert.equal(hermes.counters.access.socketsDisconnected, 1);
	assert.equal(hermes.sessionCache.size, 0);
	await assert.rejects(() => connect(t, baseUrl, 'user-token'), /unauthorized/);
});

test('unchanged access leaves the socket and its rooms as they were', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer({ projectIds: ['project-1', 'project-2'] }));
	gaia.introspects('other-token', activeAnswer({ sub: 'user-2', projectIds: ['project-2'] }));
	const client = await connect(t, baseUrl, 'user-token');
	const other = await connect(t, baseUrl, 'other-token');
	const events = received(client);
	await subscribe(client, TWO_PROJECTS);

	await publish(baseUrl, 'user.access.changed', 'user:user-1');
	await until(() => hermes.counters.access.socketsRechecked === 1);

	assert.equal(hermes.counters.access.intentsDropped, 0);
	assert.equal(hermes.counters.access.socketsDisconnected, 0);
	assert.equal(introspectionCalls(gaia, 'other-token'), 1);
	assert.equal(client.connected, true);
	assert.equal(other.connected, true);

	await publish(baseUrl, 'issue.created', 'project-2');
	await until(() => events.includes('project-2 issue.created'));
});

test('a socket whose re-check cannot reach Gaia is disconnected', async (t) => {
	const { gaia, hermes, baseUrl, serviceToken } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer());
	const client = await connect(t, baseUrl, 'user-token');

	serviceToken.value = null;
	const disconnected = new Promise((resolve) => client.once('disconnect', resolve));
	await publish(baseUrl, 'user.access.changed', 'user:user-1');

	assert.equal(await disconnected, 'io server disconnect');
	assert.equal(hermes.counters.access.failures, 1);
});

test('other events and non-user scopes start no re-check', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer());
	await connect(t, baseUrl, 'user-token');

	await publish(baseUrl, 'issue.created', 'project-1');
	await publish(baseUrl, 'user.access.changed', 'project-1');
	assert.equal(hermes.counters.access.events, 0);
	assert.equal(introspectionCalls(gaia, 'user-token'), 1);
});
