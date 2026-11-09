const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStubGaia } = require('../support/stub-gaia');
const { ServiceIdentity } = require('../../src/auth/service-identity');
const { CredentialStore } = require('../../src/auth/credential-store');
const { RetryScheduler } = require('../../src/auth/retry-scheduler');
const { createGaiaIdentityClient } = require('../../src/auth/gaia-identity-client');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-09T05:00:00Z');

function fakeTimers() {
	return {
		setTimeout(fn, ms) {
			return { fn, ms, cleared: false };
		},
		clearTimeout(handle) {
			handle.cleared = true;
		}
	};
}

function captureLogger() {
	const lines = [];
	return {
		lines,
		info: (line) => lines.push(`info ${line}`),
		error: (line) => lines.push(`error ${line}`)
	};
}

function tempCredentialFile() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-identity-'));
	return path.join(dir, 'nested', 'credential.json');
}

async function setup({ enrollmentToken = null, stored = null, sleep = null, clock = { now: NOW }, expiresIn, storeOverride = null } = {}) {
	const gaia = await startStubGaia({ expiresIn });
	const file = tempCredentialFile();
	const store = storeOverride || new CredentialStore(file);
	if (stored) {
		store.save(stored);
	}
	const logger = captureLogger();
	const identity = new ServiceIdentity({
		client: createGaiaIdentityClient({ gaiaUrl: gaia.url }),
		store,
		logger,
		name: 'Hermes test',
		enrollmentToken,
		retryDelayMs: 60000,
		now: () => clock.now,
		timers: fakeTimers(),
		sleep: sleep || (async () => {})
	});
	return { gaia, file, store, logger, identity, clock };
}

function assertNoSecretsLogged(logger, gaia) {
	const text = logger.lines.join('\n');
	for (const secret of gaia.state.secrets.values()) {
		assert.ok(!text.includes(secret), 'a secret was logged');
	}
	for (const token of gaia.state.tokens.keys()) {
		assert.ok(!text.includes(token), 'a token was logged');
	}
	for (const enrollment of gaia.state.enrollments.values()) {
		assert.ok(!text.includes(enrollment.pollToken), 'a poll token was logged');
	}
}

test('an enrollment token enrolls at once, stores the credential and gets a token', async (t) => {
	const { gaia, file, store, logger, identity } = await setup({ enrollmentToken: 'enroll-token-1' });
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), true);

	const request = gaia.requests[0];
	assert.equal(request.method, 'POST');
	assert.equal(request.path, '/api/v1/serviceenrollment');
	assert.deepEqual(JSON.parse(request.body), {
		data: { type: 'serviceenrollment', attributes: { name: 'Hermes test', kind: 'hermes', enrollmentToken: 'enroll-token-1' } }
	});
	assert.deepEqual(store.load(), {
		clientId: 'hermes_enr-1',
		clientSecret: 'secret-enr-1',
		serviceClientId: 'sc-enr-1',
		secretIssuedAt: new Date(NOW).toISOString()
	});
	if (process.platform !== 'win32') {
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	}
	assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credential.json']);

	const tokenRequest = gaia.requests.find((r) => r.path === '/api/v1/token');
	assert.equal(tokenRequest.headers['content-type'], 'application/x-www-form-urlencoded');
	assert.equal(new URLSearchParams(tokenRequest.body).get('grant_type'), 'client_credentials');
	assert.equal(identity.getAccessToken(), 'access-1');

	assert.ok(!logger.lines.some((line) => line.includes('ABC-DEF')), 'no user code is logged when pre-approved');
	assertNoSecretsLogged(logger, gaia);
});

test('without a token Hermes logs the user code once and polls until an admin approves', async (t) => {
	let polls = 0;
	let gaiaRef;
	const { gaia, store, logger, identity } = await setup({
		sleep: async () => {
			polls += 1;
			if (polls === 2) {
				gaiaRef.approve('enr-1');
			}
		}
	});
	gaiaRef = gaia;
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), true);

	const body = JSON.parse(gaia.requests[0].body);
	assert.equal(body.data.attributes.enrollmentToken, undefined);
	const pollRequests = gaia.requests.filter((r) => r.method === 'GET');
	assert.equal(pollRequests.length, 3);
	assert.equal(pollRequests[0].query, '?pollToken=poll-enr-1');
	assert.equal(logger.lines.filter((line) => line.includes('ABC-DEF')).length, 1);
	assert.equal(store.load().serviceClientId, 'sc-enr-1');
	assert.equal(identity.getAccessToken(), 'access-1');
	assertNoSecretsLogged(logger, gaia);
});

test('a denied enrollment is logged and retried in the background', async (t) => {
	let gaiaRef;
	const { gaia, logger, identity } = await setup({
		sleep: async () => gaiaRef.deny('enr-1')
	});
	gaiaRef = gaia;
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), false);
	assert.ok(logger.lines.some((line) => line.startsWith('error') && line.includes('start failed (enrollment denied)')));
	const retry = identity.scheduler.handles.get('start');
	assert.equal(retry.ms, 60000);
	assert.equal(identity.getAccessToken(), null);
});

test('a refused enrollment token falls back to admin approval on the next attempt', async (t) => {
	let gaiaRef;
	const { gaia, identity } = await setup({
		enrollmentToken: 'wrong-token',
		sleep: async () => gaiaRef.approve('enr-1')
	});
	gaiaRef = gaia;
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), false);
	assert.equal(await identity.scheduler.handles.get('start').fn(), true);

	const posts = gaia.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/serviceenrollment');
	assert.equal(JSON.parse(posts[0].body).data.attributes.enrollmentToken, 'wrong-token');
	assert.equal(JSON.parse(posts[1].body).data.attributes.enrollmentToken, undefined);
});

test('a 429 from enrollment waits for Retry-After before retrying', async (t) => {
	const { gaia, identity } = await setup();
	gaia.state.enrollmentStatus = 429;
	identity.scheduler.retryDelayMs = 1000;
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), false);
	assert.equal(identity.scheduler.handles.get('start').ms, 120000);
});

test('a restart with a stored credential gets a token without enrolling', async (t) => {
	const { gaia, identity } = await setup({
		stored: {
			clientId: 'hermes_stored',
			clientSecret: 'stored-secret',
			serviceClientId: 'sc-stored',
			secretIssuedAt: new Date(NOW - DAY_MS).toISOString()
		}
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), true);
	assert.equal(gaia.requests.filter((r) => r.path.startsWith('/api/v1/serviceenrollment')).length, 0);
	assert.equal(identity.getAccessToken(), 'access-1');
	assert.equal(identity.scheduler.handles.get('rotate').ms, 6 * DAY_MS, 'rotation is due a week after the secret was issued');
});

test('the token is refreshed before it expires', async (t) => {
	const clock = { now: NOW };
	const { gaia, identity } = await setup({
		clock,
		expiresIn: 3600,
		stored: { clientId: 'hermes_stored', clientSecret: 'stored-secret', serviceClientId: 'sc-stored', secretIssuedAt: new Date(NOW).toISOString() }
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	await identity.start();
	const refresh = identity.scheduler.handles.get('refresh');
	assert.equal(refresh.ms, 3600 * 1000 * 0.8);

	clock.now += refresh.ms;
	await refresh.fn();
	assert.equal(identity.getAccessToken(), 'access-2');
	assert.ok(identity.scheduler.handles.get('refresh'), 'the next refresh is scheduled');

	clock.now += 3600 * 1000;
	assert.equal(identity.getAccessToken(), null, 'an expired token is not handed out');
});

test('a failed refresh keeps the current token and retries', async (t) => {
	const { gaia, logger, identity } = await setup({
		stored: { clientId: 'hermes_stored', clientSecret: 'stored-secret', serviceClientId: 'sc-stored', secretIssuedAt: new Date(NOW).toISOString() }
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	await identity.start();
	gaia.state.secrets.set('hermes_stored', 'changed-elsewhere');
	await identity.scheduler.handles.get('refresh').fn();

	assert.equal(identity.getAccessToken(), 'access-1');
	assert.equal(identity.scheduler.handles.get('token refresh').ms, 60000);
	assert.ok(logger.lines.some((line) => line.includes('token refresh failed (gaia token 401)')));
});

test('an overdue secret is rotated, stored at once and used for the next token', async (t) => {
	const { gaia, store, logger, identity } = await setup({
		stored: {
			clientId: 'hermes_stored',
			clientSecret: 'stored-secret',
			serviceClientId: 'sc-stored',
			secretIssuedAt: new Date(NOW - 8 * DAY_MS).toISOString()
		}
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	await identity.start();
	const rotation = identity.scheduler.handles.get('rotate');
	assert.equal(rotation.ms, 0);
	await rotation.fn();

	const patch = gaia.requests.find((r) => r.method === 'PATCH');
	assert.equal(patch.path, '/api/v1/serviceclient/sc-stored');
	assert.equal(patch.headers.authorization, 'Bearer access-1');
	assert.deepEqual(JSON.parse(patch.body), {
		data: { type: 'serviceclient', id: 'sc-stored', attributes: { rotateSecret: true } }
	});
	assert.deepEqual(store.load(), {
		clientId: 'hermes_stored',
		clientSecret: 'stored-secret-rotated',
		serviceClientId: 'sc-stored',
		secretIssuedAt: new Date(NOW).toISOString()
	});
	assert.equal(identity.scheduler.handles.get('rotate').ms, 7 * DAY_MS);

	await identity.scheduler.handles.get('refresh').fn();
	const lastToken = gaia.requests.filter((r) => r.path === '/api/v1/token').pop();
	assert.equal(new URLSearchParams(lastToken.body).get('client_secret'), 'stored-secret-rotated');
	assert.equal(identity.getAccessToken(), 'access-2');
	assertNoSecretsLogged(logger, gaia);
});

test('a credential without serviceClientId keeps working but does not rotate', async (t) => {
	const { gaia, logger, identity } = await setup({
		stored: { clientId: 'hermes_stored', clientSecret: 'stored-secret' }
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), true);
	assert.equal(identity.scheduler.handles.get('rotate'), undefined);
	assert.ok(logger.lines.some((line) => line.includes('no serviceClientId stored')));
});

test('stop cancels every pending timer', async (t) => {
	const { gaia, identity } = await setup({
		stored: { clientId: 'hermes_stored', clientSecret: 'stored-secret', serviceClientId: 'sc-stored', secretIssuedAt: new Date(NOW).toISOString() }
	});
	t.after(() => gaia.close());

	await identity.start();
	const handles = [...identity.scheduler.handles.values()];
	identity.stop();
	assert.ok(handles.length >= 2);
	assert.ok(handles.every((handle) => handle.cleared));
	assert.equal(identity.scheduler.handles.size, 0);
});

test('a delivered credential that cannot be stored is kept in memory and saved later, without enrolling again', async (t) => {
	const saved = [];
	let failSaves = true;
	const store = {
		load: () => null,
		save(credential) {
			if (failSaves) {
				throw Object.assign(new Error('read-only'), { code: 'EROFS' });
			}
			saved.push(credential);
		}
	};
	const { gaia, logger, identity } = await setup({ enrollmentToken: 'enroll-token-1', storeOverride: store });
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), true, 'the relay gets its token from the in-memory credential');
	assert.ok(logger.lines.some((line) => line.includes('could not store the credential (EROFS)')));

	failSaves = false;
	identity.scheduler.handles.get('store credential').fn();
	assert.equal(saved.length, 1);
	assert.equal(saved[0].clientSecret, 'secret-enr-1');
	assert.equal(gaia.requests.filter((r) => r.method === 'POST' && r.path === '/api/v1/serviceenrollment').length, 1);
	assertNoSecretsLogged(logger, gaia);
});

test('enrollment polls honour a 429 Retry-After and end on another 4xx', async (t) => {
	const waits = [];
	const { gaia, logger, identity } = await setup({
		sleep: async (ms) => waits.push(ms)
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});
	const failures = [
		Object.assign(new Error('gaia enrollment poll 429'), { status: 429, retryAfterSeconds: 30 }),
		Object.assign(new Error('gaia enrollment poll 503'), { status: 503 }),
		Object.assign(new Error('gaia enrollment poll 403'), { status: 403 })
	];
	identity.client.pollEnrollment = async () => {
		throw failures.shift();
	};

	assert.equal(await identity.start(), false);
	assert.deepEqual(waits, [30000, 5000]);
	assert.ok(logger.lines.some((line) => line.includes('enrollment poll refused (403)')));
});

test('polling gives up when the request is not approved in time', async (t) => {
	const clock = { now: NOW };
	const { gaia, logger, identity } = await setup({
		clock,
		sleep: async () => {
			clock.now += 5 * 60 * 1000;
		}
	});
	t.after(() => {
		identity.stop();
		return gaia.close();
	});

	assert.equal(await identity.start(), false);
	assert.ok(logger.lines.some((line) => line.includes('enrollment was not approved in time')));
	assert.equal(gaia.requests.filter((r) => r.method === 'GET').length, 4);
});

test('stop wakes a pending poll so the enrollment ends', async (t) => {
	const gaia = await startStubGaia();
	t.after(() => gaia.close());
	const scheduler = new RetryScheduler({ timers: fakeTimers(), logger: captureLogger() });
	const identity = new ServiceIdentity({
		client: createGaiaIdentityClient({ gaiaUrl: gaia.url }),
		store: new CredentialStore(tempCredentialFile()),
		logger: captureLogger(),
		name: 'Hermes test',
		scheduler
	});

	const started = identity.start();
	while (scheduler.sleepers.size === 0) {
		await new Promise((resolve) => setImmediate(resolve));
	}
	identity.stop();
	assert.equal(await started, false);
	assert.equal(scheduler.handles.size, 0);
});
