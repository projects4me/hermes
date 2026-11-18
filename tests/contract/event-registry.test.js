const test = require('node:test');
const assert = require('node:assert/strict');
const { compareRegistry } = require('../../scripts/check-event-registry');

const registry = [
	{ name: 'a.created', scopes: ['project'], channels: ['hermes'], enabled: true },
	{ name: 'u.changed', scopes: ['user'], channels: ['hermes'], enabled: true },
	{ name: 'wf.only', scopes: ['project'], channels: ['workflow'], enabled: true },
	{ name: 'off', scopes: ['project'], channels: ['hermes'], enabled: false }
];

test('matching lists pass; non-hermes and disabled events are ignored', () => {
	assert.deepEqual(compareRegistry(registry, ['a.created', 'u.changed'], ['u.changed']), []);
});

test('a name missing in Hermes fails', () => {
	const out = compareRegistry(registry, ['a.created'], ['u.changed']);
	assert.ok(out.some((l) => l.includes('EVENT_ALLOWLIST') && l.includes('missing') && l.includes('u.changed')));
});

test('an extra name in Hermes fails', () => {
	const out = compareRegistry(registry, ['a.created', 'u.changed', 'x.extra'], ['u.changed']);
	assert.ok(out.some((l) => l.includes('extra') && l.includes('x.extra')));
});

test('user scope drift fails both ways', () => {
	assert.ok(compareRegistry(registry, ['a.created', 'u.changed'], []).some((l) => l.includes('USER_SCOPED_EVENTS: missing')));
	assert.ok(compareRegistry(registry, ['a.created', 'u.changed'], ['u.changed', 'a.created']).some((l) => l.includes('USER_SCOPED_EVENTS: extra')));
});
