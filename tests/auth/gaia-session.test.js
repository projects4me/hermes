const test = require('node:test');
const assert = require('node:assert/strict');
const { createGaiaSessionLoader, toSession } = require('../../src/auth/gaia-session');
const { startStubGaia } = require('../support/stub-gaia');
const { activeAnswer, serviceAnswer } = require('../support/introspection');

async function setup(t, serviceToken = 'svc-1') {
	const gaia = await startStubGaia();
	t.after(() => gaia.close());
	gaia.issueServiceToken('svc-1');
	const loadSession = createGaiaSessionLoader({ gaiaUrl: gaia.url, getServiceToken: () => serviceToken });
	return { gaia, loadSession };
}

test('an active user token becomes a session from one introspection call with the service token', async (t) => {
	const { gaia, loadSession } = await setup(t);
	const answer = activeAnswer({ projectIds: ['p-1', 2] });
	gaia.introspects('user-token', answer);

	const session = await loadSession('user-token');

	assert.deepEqual(session, {
		userId: 'user-1',
		actorType: 'user',
		projectIds: ['p-1', '2'],
		expiresAt: answer.exp * 1000
	});
	assert.equal(gaia.requests.length, 1);
	const request = gaia.requests[0];
	assert.equal(request.method, 'POST');
	assert.equal(request.path, '/api/v1/introspect');
	assert.equal(request.headers.authorization, 'Bearer svc-1');
	assert.equal(new URLSearchParams(request.body).get('token'), 'user-token');
});

test('agent tokens, delegated ones included, become agent sessions', async (t) => {
	const { gaia, loadSession } = await setup(t);
	gaia.introspects('agent-token', activeAnswer({ sub: 'agent-user-1', actorType: 'agent', projectIds: [] }));
	gaia.introspects('delegated-token', activeAnswer({
		sub: 'agent-user-1', actorType: 'agent', act: 'svc_runtime', serviceKind: 'runtime', projectIds: ['p-9']
	}));

	assert.equal((await loadSession('agent-token')).actorType, 'agent');
	const delegated = await loadSession('delegated-token');
	assert.equal(delegated.actorType, 'agent');
	assert.equal(delegated.userId, 'agent-user-1');
	assert.deepEqual(delegated.projectIds, ['p-9']);
});

test('an inactive token is no session', async (t) => {
	const { loadSession } = await setup(t);
	assert.equal(await loadSession('unknown-token'), null);
});

test('a service token is reported with its actor type and no user', async (t) => {
	const { gaia, loadSession } = await setup(t);
	gaia.introspects('other-service-token', serviceAnswer());
	const session = await loadSession('other-service-token');
	assert.equal(session.actorType, 'service');
	assert.equal(session.userId, null);
});

test('without a service token Hermes does not call Gaia and fails closed', async (t) => {
	const { gaia, loadSession } = await setup(t, null);
	await assert.rejects(() => loadSession('user-token'), /no Hermes service token/);
	assert.equal(gaia.requests.length, 0);
});

test('a refused service token fails closed with the status only', async (t) => {
	const { loadSession } = await setup(t, 'not-issued');
	await assert.rejects(
		() => loadSession('user-token'),
		(error) => error.status === 401 && !error.message.includes('user-token')
	);
});

test('answers without an actor type or an expiry are no session', () => {
	assert.equal(toSession({ active: true, sub: 'u', exp: 100 }), null);
	assert.equal(toSession(activeAnswer({ exp: null })), null);
	assert.equal(toSession({ active: false }), null);
	assert.equal(toSession(null), null);
});
