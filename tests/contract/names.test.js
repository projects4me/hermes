const test = require('node:test');
const assert = require('node:assert/strict');
const {
	EVENT_ALLOWLIST,
	USER_SCOPED_EVENTS,
	RUNTIMES_SCOPE,
	RUNTIME_SCOPED_EVENTS,
	SERVICE_SCOPED_EVENTS,
	serviceKindFromScope,
	isServiceScopedEvent,
	isAllowedOnServiceScope,
	userIdFromScope
} = require('../../src/contract');

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
		'doc.created',
		'doc.updated',
		'doc.deleted',
		'workflow.agent.run.requested',
		'user.access.changed',
		'user.mentioned',
		'workflow.run.finished',
		'search.semantic.changed'
	]);
});

test('user-scoped events are the exact approved set', () => {
	assert.deepEqual([...USER_SCOPED_EVENTS], [
		'notification.created',
		'workflow.agent.run.requested',
		'user.access.changed',
		'user.mentioned'
	]);
});

test('the runtimes scope carries workflow.agent.run.requested only', () => {
	assert.equal(RUNTIMES_SCOPE, 'runtimes');
	assert.deepEqual([...RUNTIME_SCOPED_EVENTS], ['workflow.agent.run.requested']);
});

test('userIdFromScope returns the user id of a user scope only', () => {
	assert.equal(userIdFromScope('user:42'), '42');
	assert.equal(userIdFromScope('user:'), null);
	assert.equal(userIdFromScope('project-1'), null);
	assert.equal(userIdFromScope(undefined), null);
});

test('the ares service scope carries search.semantic.changed only', () => {
	assert.deepEqual([...SERVICE_SCOPED_EVENTS.keys()], ['ares']);
	assert.deepEqual([...SERVICE_SCOPED_EVENTS.get('ares')], ['search.semantic.changed']);
	assert.equal(isServiceScopedEvent('search.semantic.changed'), true);
	assert.equal(isServiceScopedEvent('issue.created'), false);
	assert.equal(isAllowedOnServiceScope('service:ares', 'search.semantic.changed'), true);
	assert.equal(isAllowedOnServiceScope('service:ares', 'issue.created'), false);
	assert.equal(isAllowedOnServiceScope('service:runtime', 'search.semantic.changed'), false);
	assert.equal(isAllowedOnServiceScope('project-1', 'search.semantic.changed'), false);
});

test('serviceKindFromScope returns the service kind of a service scope only', () => {
	assert.equal(serviceKindFromScope('service:ares'), 'ares');
	assert.equal(serviceKindFromScope('service:'), null);
	assert.equal(serviceKindFromScope('user:42'), null);
	assert.equal(serviceKindFromScope(undefined), null);
});

test('workflow.run.finished is project-scoped: not user, runtime or service scoped', () => {
	assert.equal(EVENT_ALLOWLIST.includes('workflow.run.finished'), true);
	assert.equal(USER_SCOPED_EVENTS.has('workflow.run.finished'), false);
	assert.equal(RUNTIME_SCOPED_EVENTS.has('workflow.run.finished'), false);
	assert.equal(isServiceScopedEvent('workflow.run.finished'), false);
});
