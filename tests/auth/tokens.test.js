const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSocketToken } = require('../../src/auth/tokens');

test('auth and header tokens are accepted; query tokens are not', () => {
	assert.deepEqual(extractSocketToken({ auth: { token: 'a' }, headers: {}, query: {} }), {
		token: 'a',
		source: 'auth'
	});
	assert.deepEqual(extractSocketToken({
		auth: {},
		headers: { authorization: 'Bearer header-token' },
		query: {}
	}), {
		token: 'header-token',
		source: 'header'
	});
	assert.equal(extractSocketToken({ auth: {}, headers: {}, query: { token: 'q' } }), null);
	assert.deepEqual(extractSocketToken({
		auth: '{"token":"from-json"}',
		headers: {},
		query: {}
	}), {
		token: 'from-json',
		source: 'auth'
	});
});
