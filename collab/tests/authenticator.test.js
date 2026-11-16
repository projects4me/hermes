const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuthenticator, AccessDenied } = require('../src/authenticator');
const { createGaiaClient } = require('../src/gaia-client');
const { startStubGaia, WRITER, READER } = require('./support/stub-gaia');

async function setup(t) {
	const gaia = await startStubGaia();
	t.after(() => gaia.close());
	gaia.addDoc('doc-1', { projectId: 'project-1' });
	gaia.addDoc('doc-locked', { projectId: 'project-1', locked: true });
	const authenticate = createAuthenticator({ gaia: createGaiaClient({ gaiaUrl: gaia.url }) });
	return { gaia, authenticate };
}

test('a writer opens doc:<id> with write access, checked with their own token', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('writer-token', { id: 'user-1', permissions: WRITER });

	const access = await authenticate({ token: 'writer-token', documentName: 'doc:doc-1' });

	assert.deepEqual(access, { userId: 'user-1', docId: 'doc-1', projectId: 'project-1', canWrite: true });
	assert.deepEqual(gaia.requests.map((request) => request.path), ['/api/v1/user/me', '/api/v1/doc/doc-1']);
	assert.equal(gaia.requests[0].query.get('include'), 'aclPermissions');
	assert.ok(gaia.requests.every((request) => request.headers.authorization === 'Bearer writer-token'));
});

test('a token Gaia rejects is refused', async (t) => {
	const { authenticate } = await setup(t);

	await assert.rejects(authenticate({ token: 'unknown-token', documentName: 'doc:doc-1' }), AccessDenied);
	await assert.rejects(authenticate({ token: '', documentName: 'doc:doc-1' }), AccessDenied);
});

test('a user without doc.get is refused before the doc is read', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('no-get-token', { id: 'user-2', permissions: { 'doc.get': 0, 'doc.update': 1 } });
	gaia.addUser('missing-get-token', { id: 'user-3', permissions: { 'doc.update': 1 } });

	await assert.rejects(authenticate({ token: 'no-get-token', documentName: 'doc:doc-1' }), /no doc.get/);
	await assert.rejects(authenticate({ token: 'missing-get-token', documentName: 'doc:doc-1' }), /no doc.get/);
	assert.ok(gaia.requests.every((request) => request.path === '/api/v1/user/me'));
});

test('a doc Gaia does not show the user (404) is refused', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('outsider-token', { id: 'user-4', permissions: WRITER, docIds: [] });

	await assert.rejects(authenticate({ token: 'outsider-token', documentName: 'doc:doc-1' }), /doc not readable/);
	await assert.rejects(authenticate({ token: 'outsider-token', documentName: 'doc:missing' }), /doc not readable/);
});

test('other document names are refused without calling Gaia', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('writer-token', { id: 'user-1', permissions: WRITER });

	for (const documentName of ['doc-1', 'doc:', 'doc:../user/me', 'issue:doc-1']) {
		await assert.rejects(authenticate({ token: 'writer-token', documentName }), /unknown document name/);
	}
	assert.equal(gaia.requests.length, 0);
});

test('a user without doc.update gets a read-only connection', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('reader-token', { id: 'user-5', permissions: READER });

	const access = await authenticate({ token: 'reader-token', documentName: 'doc:doc-1' });

	assert.equal(access.canWrite, false);
});

test('a locked doc is read-only, even for a writer', async (t) => {
	const { gaia, authenticate } = await setup(t);
	gaia.addUser('writer-token', { id: 'user-1', permissions: WRITER });

	const access = await authenticate({ token: 'writer-token', documentName: 'doc:doc-locked' });

	assert.equal(access.canWrite, false);
});

test('an unreachable Gaia fails the check without naming the token', async () => {
	const authenticate = createAuthenticator({ gaia: createGaiaClient({ gaiaUrl: 'http://127.0.0.1:1', timeoutMs: 500 }) });

	await assert.rejects(authenticate({ token: 'secret-token', documentName: 'doc:doc-1' }), (error) => {
		assert.match(error.message, /unreachable/);
		assert.doesNotMatch(error.message, /secret-token/);
		return true;
	});
});
