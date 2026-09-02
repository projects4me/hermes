const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEventEnvelope } = require('../../src/contract');

test('event envelope validation accepts version 1 and rejects unknown events', () => {
	const envelope = {
		schemaVersion: 1,
		eventId: 'event-1',
		eventName: 'issue.created',
		occurredAt: '2026-08-20T10:00:00Z',
		projectId: 'project-1',
		resource: { type: 'issue', id: 'issue-1' },
		actorId: null,
		changes: {},
		meta: { source: 'test' }
	};
	assert.equal(validateEventEnvelope(envelope), true);
	assert.equal(validateEventEnvelope({ ...envelope, eventName: 'issue.deleted' }), false);
	assert.equal(validateEventEnvelope({ ...envelope, originSocketId: 'abc123' }), false);
});
