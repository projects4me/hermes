const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_ALLOWLIST, USER_SCOPED_EVENTS, userIdFromScope } = require('../../src/contract');

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
		'notification.created',
		'idea.created',
		'idea.updated',
		'idea.message.created',
		'idea.plan.created',
		'idea.plan.status.changed',
		'idea.planissue.created',
		'workflow.agent.run.requested',
		'user.access.changed'
	]);
});

test('user-scoped events are the exact approved set', () => {
	assert.deepEqual([...USER_SCOPED_EVENTS], [
		'notification.created',
		'workflow.agent.run.requested',
		'user.access.changed'
	]);
});

test('userIdFromScope returns the user id of a user scope only', () => {
	assert.equal(userIdFromScope('user:42'), '42');
	assert.equal(userIdFromScope('user:'), null);
	assert.equal(userIdFromScope('project-1'), null);
	assert.equal(userIdFromScope(undefined), null);
});
