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

test('session cache entries never outlive the token', () => {
	let now = 0;
	const cache = new SessionCache({ ttlMs: 100, maxEntries: 5, now: () => now });
	cache.set('short', { userId: 'a', expiresAt: 30 });
	cache.set('long', { userId: 'b', expiresAt: 1000 });
	cache.set('expired', { userId: 'c', expiresAt: 0 });
	assert.equal(cache.get('expired'), null);
	assert.equal(cache.size, 2);

	now = 30;
	assert.equal(cache.get('short'), null);
	assert.equal(cache.get('long').userId, 'b');

	now = 100;
	assert.equal(cache.get('long'), null);
});

test('evictUser removes every cached session of that user only', () => {
	const cache = new SessionCache({ ttlMs: 1000, maxEntries: 10, now: () => 0 });
	cache.set('token-a1', { userId: 'a' });
	cache.set('token-a2', { userId: 'a' });
	cache.set('token-b', { userId: 'b' });
	assert.equal(cache.evictUser('a'), 2);
	assert.equal(cache.get('token-a1'), null);
	assert.equal(cache.get('token-a2'), null);
	assert.deepEqual(cache.get('token-b'), { userId: 'b' });
});
