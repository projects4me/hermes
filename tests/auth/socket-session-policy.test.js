const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsSocketSession, socketServiceKind } = require('../../src/auth/socket-session-policy');

const now = 1000;

test('user and agent sessions with time left may open a socket', () => {
	assert.equal(acceptsSocketSession({ userId: 'u', actorType: 'user', expiresAt: 2000 }, now), true);
	assert.equal(acceptsSocketSession({ userId: 'a', actorType: 'agent', expiresAt: 2000 }, now), true);
});

test('runtime service sessions with time left may open a socket', () => {
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'runtime', expiresAt: 2000 }, now), true);
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'runtime', expiresAt: 1000 }, now), false);
});

test('service sessions of a kind with service-scoped events may open a socket', () => {
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'ares', expiresAt: 2000 }, now), true);
	assert.equal(acceptsSocketSession({ userId: null, actorType: 'service', serviceKind: 'ares', expiresAt: 1000 }, now), false);
});

test('only runtime and scoped service tokens have a socket service kind', () => {
	assert.equal(socketServiceKind({ actorType: 'service', serviceKind: 'ares' }), 'ares');
	assert.equal(socketServiceKind({ actorType: 'service', serviceKind: 'runtime' }), 'runtime');
	assert.equal(socketServiceKind({ actorType: 'service', serviceKind: 'hermes' }), null);
	assert.equal(socketServiceKind({ actorType: 'service', serviceKind: null }), null);
	assert.equal(socketServiceKind({ actorType: 'agent', serviceKind: 'ares', userId: 'a' }), null);
	assert.equal(socketServiceKind({ actorType: 'agent', serviceKind: 'runtime', userId: 'a' }), null);
	assert.equal(socketServiceKind({ actorType: 'user', userId: 'u' }), null);
	assert.equal(socketServiceKind(null), null);
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
