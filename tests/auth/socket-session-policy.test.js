const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsSocketSession, isRuntimeSession } = require('../../src/auth/socket-session-policy');

const now = 1000;

test('user and agent sessions with time left may open a socket', () => {
	assert.equal(acceptsSocketSession({ userId: 'u', actorType: 'user', expiresAt: 2000 }, now), true);
	assert.equal(acceptsSocketSession({ userId: 'a', actorType: 'agent', expiresAt: 2000 }, now), true);
});

test('runtime service sessions with time left may open a socket', () => {
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'runtime', expiresAt: 2000 }, now), true);
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'runtime', expiresAt: 1000 }, now), false);
});

test('only service tokens of kind runtime are runtime sessions', () => {
	assert.equal(isRuntimeSession({ actorType: 'service', serviceKind: 'runtime' }), true);
	assert.equal(isRuntimeSession({ actorType: 'service', serviceKind: 'hermes' }), false);
	assert.equal(isRuntimeSession({ actorType: 'agent', serviceKind: 'runtime', userId: 'a' }), false);
	assert.equal(isRuntimeSession(null), false);
});

test('other service sessions, expired tokens and missing users are refused', () => {
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', expiresAt: 2000 }, now), false);
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'hermes', expiresAt: 2000 }, now), false);
	assert.equal(acceptsSocketSession({ userId: 'u', actorType: 'service', expiresAt: 2000 }, now), false);
	assert.equal(acceptsSocketSession({ userId: 'u', actorType: 'user', expiresAt: 1000 }, now), false);
	assert.equal(acceptsSocketSession({ userId: 'u', actorType: 'user' }, now), false);
	assert.equal(acceptsSocketSession({ actorType: 'user', expiresAt: 2000 }, now), false);
	assert.equal(acceptsSocketSession(null, now), false);
});
