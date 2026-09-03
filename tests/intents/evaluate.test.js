const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_INTENTS } = require('../../src/contract');
const { compositeRoom } = require('../../src/intents/rooms');
const { evaluateIntentSet } = require('../../src/intents/evaluate');

test('intent evaluation authorizes, deduplicates, and rejects stale revisions', () => {
	const state = { revision: 1, rooms: new Set() };
	const payload = {
		protocolVersion: 1,
		revision: 2,
		intents: [
			{ projectId: 'p/1', eventName: 'issue.created' },
			{ projectId: 'p/1', eventName: 'issue.created' },
			{ projectId: 'p2', eventName: 'milestone.created' }
		]
	};
	const result = evaluateIntentSet(payload, state, ['p/1']);

	assert.equal(result.ok, true);
	assert.deepEqual(result.ack.accepted, [
		{ projectId: 'p/1', eventName: 'issue.created' }
	]);
	assert.deepEqual(result.ack.rejected, [
		{ projectId: 'p/1', eventName: 'issue.created', reason: 'duplicate_intent' },
		{ projectId: 'p2', eventName: 'milestone.created', reason: 'project_not_authorized' }
	]);
	assert.deepEqual([...result.nextState.rooms], [
		compositeRoom('p/1', 'issue.created')
	]);

	const stale = evaluateIntentSet({ ...payload, revision: 1 }, state, ['p/1']);
	assert.equal(stale.ok, false);
	assert.equal(stale.stale, true);
	assert.equal(stale.ack.rejected[0].reason, 'stale_revision');
});

test('intent payload is capped at the contract maximum', () => {
	const intent = { projectId: 'p1', eventName: 'issue.created' };
	const result = evaluateIntentSet({
		protocolVersion: 1,
		revision: 0,
		intents: Array.from({ length: MAX_INTENTS + 1 }, () => intent)
	}, { revision: -1, rooms: new Set() }, ['p1']);

	assert.equal(result.ok, false);
	assert.equal(result.ack.rejected[0].reason, 'invalid_payload');
});

test('notification.created intent accepted for own user scope', () => {
	const state = { revision: -1, rooms: new Set() };
	const result = evaluateIntentSet(
		{
			protocolVersion: 1,
			revision: 0,
			intents: [{ projectId: 'user:user-1', eventName: 'notification.created' }]
		},
		state,
		[],
		'user-1'
	);
	assert.equal(result.ok, true);
	assert.equal(result.ack.accepted.length, 1);
	assert.equal(result.ack.rejected.length, 0);
	assert.deepEqual([...result.nextState.rooms], [
		compositeRoom('user:user-1', 'notification.created')
	]);
});

test('notification.created intent rejected for a different user scope', () => {
	const state = { revision: -1, rooms: new Set() };
	const result = evaluateIntentSet(
		{
			protocolVersion: 1,
			revision: 0,
			intents: [{ projectId: 'user:user-2', eventName: 'notification.created' }]
		},
		state,
		[],
		'user-1'
	);
	assert.equal(result.ok, true);
	assert.equal(result.ack.accepted.length, 0);
	assert.equal(result.ack.rejected[0].reason, 'project_not_authorized');
});
