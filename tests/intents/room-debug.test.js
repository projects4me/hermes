const test = require('node:test');
const assert = require('node:assert/strict');
const {
	describeRoomSubscribers,
	countIntentRooms,
	connectedSocketCount,
	formatIntentLabel
} = require('../../src/intents/room-debug');
const { compositeRoom, ROOM_PREFIX } = require('../../src/intents/rooms');

test('describeRoomSubscribers returns empty when room missing', () => {
	const io = {
		sockets: {
			adapter: { rooms: new Map() },
			sockets: new Map()
		}
	};
	assert.deepEqual(describeRoomSubscribers(io, 'v1:intent:p:issue.created'), {
		subscribers: 0,
		subscriberSocketIds: [],
		subscriberUserIds: []
	});
});

test('describeRoomSubscribers lists socket and user ids', () => {
	const room = compositeRoom('project-1', 'issue.status.changed');
	const rooms = new Map([[room, new Set(['sock-a', 'sock-b', 'sock-c'])]]);
	const sockets = new Map([
		['sock-a', { data: { userId: 'user-1' } }],
		['sock-b', { data: { userId: 'user-2' } }],
		['sock-c', { data: { userId: 'user-1' } }]
	]);
	const io = {
		sockets: {
			adapter: { rooms },
			sockets
		}
	};

	const info = describeRoomSubscribers(io, room);
	assert.equal(info.subscribers, 3);
	assert.deepEqual(info.subscriberSocketIds, ['sock-a', 'sock-b', 'sock-c']);
	assert.deepEqual(info.subscriberUserIds, ['user-1', 'user-2']);
});

test('countIntentRooms ignores per-socket rooms', () => {
	const intentRoom = `${ROOM_PREFIX}project-1:issue.created`;
	const rooms = new Map([
		['sock-a', new Set(['sock-a'])],
		[intentRoom, new Set(['sock-a'])],
		[`${ROOM_PREFIX}project-2:issue.created`, new Set()]
	]);
	const io = { sockets: { adapter: { rooms } } };
	assert.equal(countIntentRooms(io), 1);
});

test('connectedSocketCount prefers engine.clientsCount', () => {
	assert.equal(
		connectedSocketCount({
			engine: { clientsCount: 4 },
			sockets: { sockets: new Map([['a', {}], ['b', {}]]) }
		}),
		4
	);
	assert.equal(
		connectedSocketCount({
			sockets: { sockets: new Map([['a', {}], ['b', {}]]) }
		}),
		2
	);
});

test('formatIntentLabel joins project and event', () => {
	assert.equal(
		formatIntentLabel({ projectId: 'p1', eventName: 'issue.created' }),
		'p1:issue.created'
	);
});
