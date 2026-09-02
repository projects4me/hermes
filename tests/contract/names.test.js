const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_ALLOWLIST } = require('../../src/contract');

test('event allowlist is the exact approved contract', () => {
	assert.deepEqual(EVENT_ALLOWLIST, [
		'issue.status.changed',
		'issue.assignee.changed',
		'milestone.created',
		'milestone.completed',
		'issue.created',
		'issue.dates.changed',
		'issue.dependency.created',
		'issue.dependency.deleted',
		'conversation.comment.created',
		'conversation.comment.updated',
		'conversation.comment.deleted',
		'conversation.vote.added',
		'conversation.vote.removed',
		'conversation.created',
		'notification.created'
	]);
});
