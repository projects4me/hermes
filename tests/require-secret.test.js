const test = require('node:test');
const assert = require('node:assert/strict');
const { secretsMatch, requireSecret } = require('../src/http/middleware/require-secret');

test('secretsMatch accepts only the exact secret', () => {
	assert.equal(secretsMatch('s3cret', 's3cret'), true);
	assert.equal(secretsMatch('s3creX', 's3cret'), false);
	assert.equal(secretsMatch('short', 's3cret'), false);
	assert.equal(secretsMatch('s3cret-longer', 's3cret'), false);
	assert.equal(secretsMatch(undefined, 's3cret'), false);
	assert.equal(secretsMatch(null, 's3cret'), false);
});

function run(headers) {
	const counters = { publish: { rejected: 0 } };
	const req = { get: (n) => headers[n.toLowerCase()] };
	let status = null;
	let nexted = false;
	const res = { status(c) { status = c; return this; }, json() { return this; } };
	requireSecret({ config: { hermesSecret: 's3cret' }, counters })(req, res, () => { nexted = true; });
	return { status, nexted, counters };
}

test('middleware rejects wrong, missing and different-length secrets', () => {
	for (const h of [{ 'x-hermes-secret': 'wrong!' }, {}, { 'x-hermes-secret': 'x' }]) {
		const r = run(h);
		assert.equal(r.status, 401);
		assert.equal(r.nexted, false);
		assert.equal(r.counters.publish.rejected, 1);
	}
});

test('middleware accepts the correct secret', () => {
	assert.equal(run({ 'x-hermes-secret': 's3cret' }).nexted, true);
});
