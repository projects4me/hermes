const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: createClient } = require('socket.io-client');
const { startStubGaia } = require('./support/stub-gaia');
const { startHermes } = require('../src/start-hermes');

const USER_TOKEN = 'user-token-1';

/**
 * Session loader that accepts USER_TOKEN, so these tests check that a failing
 * identity never gates the relay without depending on introspection.
 */
async function acceptUserToken(token) {
	if (token !== USER_TOKEN) {
		return null;
	}
	return { userId: 'user-1', actorType: 'user', projectIds: ['project-1'], expiresAt: Date.now() + 3600000 };
}

function captureLogger() {
	const lines = [];
	return {
		lines,
		info: (line) => lines.push(`info ${line}`),
		warn: (line) => lines.push(`warn ${line}`),
		error: (line) => lines.push(`error ${line}`)
	};
}

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-start-'));
}

async function closedPortUrl() {
	const net = require('net');
	const server = net.createServer();
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	return `http://127.0.0.1:${port}`;
}

async function waitFor(check, message, timeoutMs = 3000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${message}`);
}

/**
 * Starts Hermes as server.js does, with a credential file configured and an
 * identity Gaia URL that may differ from the Gaia that authenticates users.
 */
async function startWithIdentity(t, { identityGaiaUrl, credentialFile, gaia }) {
	const logger = captureLogger();
	const config = {
		nodeEnv: 'test',
		port: 0,
		hermesSecret: 'test-secret',
		gaiaUrl: identityGaiaUrl,
		corsOrigin: '*',
		authCacheTtlMs: 1000,
		authCacheMaxEntries: 10,
		identity: {
			credentialFile,
			enrollmentToken: 'enroll-token-1',
			serviceName: 'Hermes test',
			pollIntervalMs: 10,
			retryDelayMs: 60000,
			rotationIntervalMs: 60000
		}
	};
	const rejections = [];
	const onRejection = (reason) => rejections.push(reason);
	process.on('unhandledRejection', onRejection);
	const hermes = startHermes(config, {
		logger,
		loadSession: acceptUserToken
	});
	t.after(async () => {
		process.off('unhandledRejection', onRejection);
		await new Promise((resolve) => hermes.stop(resolve));
	});
	await hermes.listening;
	return { hermes, logger, rejections, baseUrl: `http://127.0.0.1:${hermes.httpServer.address().port}` };
}

async function assertRelayWorks(t, { baseUrl, gaia }) {
	const client = createClient(baseUrl, { auth: { token: USER_TOKEN }, transports: ['websocket'] });
	t.after(() => client.close());
	await new Promise((resolve, reject) => {
		client.once('connect', resolve);
		client.once('connect_error', reject);
	});
	const ack = await client.emitWithAck('intents:set', {
		protocolVersion: 1,
		revision: 0,
		intents: [{ projectId: 'project-1', eventName: 'issue.created' }]
	});
	assert.equal(ack.accepted.length, 1);

	const delivered = new Promise((resolve) => client.once('domain:event', resolve));
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
	const response = await fetch(`${baseUrl}/publish`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-hermes-secret': 'test-secret' },
		body: JSON.stringify(envelope)
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await delivered, envelope);

	const health = await fetch(`${baseUrl}/health`);
	assert.equal(health.status, 200);
}

async function assertLoggedAndRetried({ logger, rejections }) {
	await waitFor(() => logger.lines.some((line) => /^error .*start failed .*retrying in/.test(line)), 'a logged retry');
	assert.deepEqual(rejections, []);
}

const cases = [
	{
		name: 'Gaia is unreachable',
		setup: async () => ({ identityGaiaUrl: await closedPortUrl() })
	},
	{
		name: 'the enrollment endpoint is not deployed (404)',
		setup: async (gaia) => {
			gaia.state.enrollmentStatus = 404;
			return { identityGaiaUrl: gaia.url };
		}
	},
	{
		name: 'the enrollment request fails with 500',
		setup: async (gaia) => {
			gaia.state.enrollmentStatus = 500;
			return { identityGaiaUrl: gaia.url };
		}
	},
	{
		name: 'the credential file is broken',
		setup: async (gaia) => {
			const file = path.join(tempDir(), 'credential.json');
			fs.writeFileSync(file, '{not json');
			return { identityGaiaUrl: gaia.url, credentialFile: file };
		}
	},
	{
		name: 'the credential file is unreadable',
		setup: async (gaia) => ({ identityGaiaUrl: gaia.url, credentialFile: tempDir() })
	}
];

for (const failure of cases) {
	test(`the relay keeps working while ${failure.name}`, async (t) => {
		const gaia = await startStubGaia();
		t.after(() => gaia.close());
		const options = await failure.setup(gaia);
		const credentialFile = options.credentialFile || path.join(tempDir(), 'credential.json');
		const started = await startWithIdentity(t, { ...options, credentialFile, gaia });

		await assertLoggedAndRetried(started);
		await assertRelayWorks(t, { baseUrl: started.baseUrl, gaia });
		assert.deepEqual(started.rejections, []);
	});
}
