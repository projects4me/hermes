const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createRoutes } = require('../src/http/routes');

const SECRET = 'routes-secret';

async function serve(t, onAccessChange = () => {}) {
	const routes = createRoutes({ secret: SECRET, onAccessChange });
	const server = http.createServer(async (request, response) => {
		if (!(await routes(request, response))) {
			response.writeHead(299);
			response.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return `http://127.0.0.1:${server.address().port}`;
}

test('the access route gets the doc id from the path and the reason from the body', async (t) => {
	const calls = [];
	const base = await serve(t, (docId, reason) => calls.push([docId, reason]));

	const response = await fetch(`${base}/internal/docs/doc-1/access?x=1`, {
		method: 'POST',
		headers: { 'X-Collab-Secret': SECRET, 'Content-Type': 'application/json' },
		body: JSON.stringify({ reason: 'locked' })
	});

	assert.equal(response.status, 202);
	assert.deepEqual(calls, [['doc-1', 'locked']]);
});

test('under /internal/ a known path with another method is 405 and an unknown path 404', async (t) => {
	const base = await serve(t);

	const get = await fetch(`${base}/internal/docs/doc-1/access`);
	assert.equal(get.status, 405);
	assert.equal(get.headers.get('allow'), 'POST');
	assert.equal((await fetch(`${base}/internal/docs/doc_1/access`, { method: 'POST' })).status, 404);
	assert.equal((await fetch(`${base}/internal/other`)).status, 404);
});

test('paths outside /internal/ are left to Hocuspocus', async (t) => {
	const base = await serve(t);

	assert.equal((await fetch(`${base}/`)).status, 299);
	assert.equal((await fetch(`${base}/internalx/docs/doc-1/access`, { method: 'POST' })).status, 299);
});

test('the router needs a secret', () => {
	assert.throws(() => createRoutes({ secret: '', onAccessChange: () => {} }), /secret/);
});
