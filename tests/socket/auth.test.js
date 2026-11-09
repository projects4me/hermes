const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createHermesApp } = require('../../src/app');
const { startStubGaia } = require('../support/stub-gaia');
const { activeAnswer, serviceAnswer } = require('../support/introspection');

const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * Hermes on a stub Gaia, with a clock the test moves and expiry timers the
 * test fires by hand.
 */
async function startHermes(t, { authCacheTtlMs = 60000 } = {}) {
	const gaia = await startStubGaia();
	gaia.issueServiceToken('svc-1');
	const clock = { offsetMs: 0 };
	const timers = [];
	const hermes = createHermesApp({
		config: {
			port: 0,
			hermesSecret: 'test-secret',
			gaiaUrl: gaia.url,
			corsOrigin: '*',
			authCacheTtlMs,
			authCacheMaxEntries: 10
		},
		getServiceToken: () => 'svc-1',
		logger: silentLogger,
		now: () => Date.now() + clock.offsetMs,
		timers: {
			setTimeout(fn, ms) {
				const timer = { fn, ms, cleared: false };
				timers.push(timer);
				return timer;
			},
			clearTimeout(timer) {
				timer.cleared = true;
			}
		}
	});
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	const baseUrl = `http://127.0.0.1:${hermes.httpServer.address().port}`;
	t.after(async () => {
		hermes.io.close();
		await gaia.close();
	});
	return { gaia, hermes, baseUrl, clock, timers };
}

function connect(t, baseUrl, token) {
	const client = createClient(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false });
	t.after(() => client.close());
	return new Promise((resolve, reject) => {
		client.once('connect', () => resolve(client));
		client.once('connect_error', (error) => reject(error));
	});
}

function introspectionCalls(gaia) {
	return gaia.requests.filter((request) => request.path === '/api/v1/introspect').length;
}

test('an active user token opens a socket scoped to its introspected projects', async (t) => {
	const { gaia, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer({ projectIds: ['project-1'] }));

	const client = await connect(t, baseUrl, 'user-token');
	const ack = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [
			{ projectId: 'project-1', eventName: 'issue.created' },
			{ projectId: 'project-2', eventName: 'issue.created' },
			{ projectId: 'user:user-1', eventName: 'notification.created' }
		]
	});
	assert.equal(ack.accepted.length, 2);
	assert.equal(ack.rejected[0].reason, 'project_not_authorized');
	assert.equal(gaia.requests.find((r) => r.path === '/api/v1/introspect').headers.authorization, 'Bearer svc-1');
});

test('an agent token opens a socket', async (t) => {
	const { gaia, baseUrl } = await startHermes(t);
	gaia.introspects('agent-token', activeAnswer({ sub: 'agent-user-1', actorType: 'agent', act: 'svc_runtime' }));
	await connect(t, baseUrl, 'agent-token');
});

test('an inactive token is unauthorized and not cached', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	await assert.rejects(() => connect(t, baseUrl, 'revoked-token'), /unauthorized/);
	await assert.rejects(() => connect(t, baseUrl, 'revoked-token'), /unauthorized/);
	assert.equal(introspectionCalls(gaia), 2);
	assert.equal(hermes.sessionCache.size, 0);
});

test('a service token of another kind cannot open a socket', async (t) => {
	const { gaia, hermes, baseUrl } = await startHermes(t);
	gaia.introspects('service-token', serviceAnswer({ serviceKind: 'hermes' }));
	await assert.rejects(() => connect(t, baseUrl, 'service-token'), /unauthorized/);
	assert.equal(hermes.counters.auth.rejected, 1);
});

test('without a service token every handshake is refused', async (t) => {
	const gaia = await startStubGaia();
	gaia.introspects('user-token', activeAnswer());
	const hermes = createHermesApp({
		config: { port: 0, hermesSecret: 's', gaiaUrl: gaia.url, corsOrigin: '*', authCacheTtlMs: 1000, authCacheMaxEntries: 10 },
		logger: silentLogger
	});
	await new Promise((resolve) => hermes.httpServer.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		hermes.io.close();
		await gaia.close();
	});
	await assert.rejects(
		() => connect(t, `http://127.0.0.1:${hermes.httpServer.address().port}`, 'user-token'),
		/unauthorized/
	);
	assert.equal(introspectionCalls(gaia), 0);
});

test('a socket is disconnected when its token expires', async (t) => {
	const { gaia, hermes, baseUrl, clock, timers } = await startHermes(t);
	const exp = Math.floor(Date.now() / 1000) + 120;
	gaia.introspects('user-token', activeAnswer({ exp }));

	const client = await connect(t, baseUrl, 'user-token');
	assert.equal(timers.length, 1);
	assert.ok(timers[0].ms > 110000 && timers[0].ms <= 120000);

	const disconnected = new Promise((resolve) => client.once('disconnect', resolve));
	clock.offsetMs = 121000;
	timers[0].fn();
	assert.equal(await disconnected, 'io server disconnect');
	assert.equal(hermes.counters.auth.expired, 1);
});

test('an early expiry timer re-arms instead of disconnecting', async (t) => {
	const { gaia, baseUrl, clock, timers } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer({ exp: Math.floor(Date.now() / 1000) + 120 }));
	const client = await connect(t, baseUrl, 'user-token');

	clock.offsetMs = 60000;
	timers[0].fn();
	assert.equal(timers.length, 2);
	assert.equal(client.connected, true);
});

test('a socket that closes first clears its expiry timer', async (t) => {
	const { gaia, hermes, baseUrl, timers } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer());
	const client = await connect(t, baseUrl, 'user-token');
	const [serverSocket] = hermes.io.sockets.sockets.values();
	const closed = new Promise((resolve) => serverSocket.once('disconnect', resolve));
	client.close();
	await closed;
	assert.equal(timers[0].cleared, true);
});

test('the session cache is bounded by the token expiry', async (t) => {
	const { gaia, hermes, baseUrl, clock } = await startHermes(t, { authCacheTtlMs: 10 * 60 * 1000 });
	gaia.introspects('user-token', activeAnswer({ exp: Math.floor(Date.now() / 1000) + 60 }));

	(await connect(t, baseUrl, 'user-token')).close();
	(await connect(t, baseUrl, 'user-token')).close();
	assert.equal(introspectionCalls(gaia), 1);
	assert.equal(hermes.counters.auth.cacheHits, 1);

	// Past exp but well inside the cache TTL: the entry is gone and Gaia,
	// now answering inactive for the expired token, refuses it.
	clock.offsetMs = 61000;
	gaia.introspects('user-token', { active: false });
	await assert.rejects(() => connect(t, baseUrl, 'user-token'), /unauthorized/);
	assert.equal(introspectionCalls(gaia), 2);
});

const RUNTIMES_INTENT = { projectId: 'runtimes', eventName: 'workflow.agent.run.requested' };

function runRequest() {
	return {
		schemaVersion: 1,
		eventId: 'event-run-1',
		eventName: 'workflow.agent.run.requested',
		occurredAt: '2026-11-09T10:00:00Z',
		projectId: 'runtimes',
		resource: { type: 'workflowRun', id: 'run-1' },
		actorId: null,
		changes: {},
		meta: { workflowId: 'workflow-1', stepId: 'step-1', entityType: 'issue', entityId: 'issue-1' }
	};
}

test('a runtime service token receives workflow.agent.run.requested on the runtimes scope', async (t) => {
	const { gaia, baseUrl } = await startHermes(t);
	gaia.introspects('runtime-token', serviceAnswer());

	const client = await connect(t, baseUrl, 'runtime-token');
	const ack = await client.emitWithAck('intents:set', { protocolVersion: 1, revision: 0, intents: [RUNTIMES_INTENT] });
	assert.deepEqual(ack.accepted, [RUNTIMES_INTENT]);
	assert.deepEqual(ack.rejected, []);

	const received = new Promise((resolve) => client.once('domain:event', resolve));
	const response = await fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-Hermes-Secret': 'test-secret' },
		body: JSON.stringify(runRequest())
	});
	assert.equal(response.status, 200);
	assert.equal((await response.json()).subscribers, 1);
	assert.deepEqual(await received, runRequest());
});

test('a runtime service token is refused project, user and other runtimes intents', async (t) => {
	const { gaia, baseUrl } = await startHermes(t);
	gaia.introspects('runtime-token', serviceAnswer({ projectIds: ['project-1'] }));

	const client = await connect(t, baseUrl, 'runtime-token');
	const ack = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [
			{ projectId: 'project-1', eventName: 'issue.created' },
			{ projectId: 'project-1', eventName: 'workflow.agent.run.requested' },
			{ projectId: 'runtimes', eventName: 'notification.created' }
		]
	});
	assert.deepEqual(ack.accepted, []);
	assert.deepEqual(ack.rejected.map((r) => r.reason),
		['project_not_authorized', 'project_not_authorized', 'project_not_authorized']);
});

test('user and agent tokens are refused the runtimes scope', async (t) => {
	const { gaia, baseUrl } = await startHermes(t);
	gaia.introspects('user-token', activeAnswer());
	gaia.introspects('agent-token', activeAnswer({ sub: 'agent-user-1', actorType: 'agent', act: 'svc_runtime', serviceKind: 'runtime' }));

	for (const token of ['user-token', 'agent-token']) {
		const client = await connect(t, baseUrl, token);
		const ack = await client.emitWithAck('intents:set', { protocolVersion: 1, revision: 0, intents: [RUNTIMES_INTENT] });
		assert.deepEqual(ack.accepted, [], token);
		assert.equal(ack.rejected[0].reason, 'project_not_authorized', token);
	}
});
