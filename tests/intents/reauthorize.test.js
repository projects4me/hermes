const test = require('node:test');
const assert = require('node:assert/strict');
const { reauthorizeIntentState } = require('../../src/intents/reauthorize');
const { compositeRoom } = require('../../src/intents/rooms');

const intents = [
	{ projectId: 'project-1', eventName: 'issue.created' },
	{ projectId: 'project-2', eventName: 'issue.created' },
	{ projectId: 'user:user-1', eventName: 'notification.created' }
];

function stateOf(list) {
	return {
		revision: 4,
		rooms: new Set(list.map((intent) => compositeRoom(intent.projectId, intent.eventName))),
		intents: list
	};
}

test('intents of projects no longer authorized are dropped, the revision kept', () => {
	const { nextState, dropped } = reauthorizeIntentState(stateOf(intents), ['project-1'], 'user-1');
	assert.equal(nextState.revision, 4);
	assert.deepEqual(dropped, [intents[1]]);
	assert.deepEqual(nextState.intents, [intents[0], intents[2]]);
	assert.deepEqual([...nextState.rooms], [
		compositeRoom('project-1', 'issue.created'),
		compositeRoom('user:user-1', 'notification.created')
	]);
});

test('unchanged access keeps every intent', () => {
	const { nextState, dropped } = reauthorizeIntentState(stateOf(intents), ['project-1', 'project-2'], 'user-1');
	assert.deepEqual(dropped, []);
	assert.deepEqual(nextState.intents, intents);
});

test('a state without intents stays empty', () => {
	const { nextState, dropped } = reauthorizeIntentState({ revision: -1, rooms: new Set() }, ['project-1'], 'user-1');
	assert.deepEqual(dropped, []);
	assert.equal(nextState.rooms.size, 0);
});
