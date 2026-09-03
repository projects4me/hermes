const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionCache } = require('../../src/auth/session-cache');

test('session cache expires entries and enforces its bound', () => {
	let now = 0;
	const cache = new SessionCache({ ttlMs: 10, maxEntries: 2, now: () => now });
	cache.set('a', { userId: 'a' });
	cache.set('b', { userId: 'b' });
	cache.set('c', { userId: 'c' });
	assert.equal(cache.get('a'), null);
	assert.equal(cache.size, 2);
	assert.equal(cache.evictions, 1);

	now = 11;
	assert.equal(cache.get('b'), null);
	assert.equal(cache.size, 0);
});
