const test = require('node:test');
const assert = require('node:assert/strict');
const { RetryScheduler } = require('../../src/auth/retry-scheduler');

function fakeTimers() {
	return {
		setTimeout: (fn, ms) => ({ fn, ms, cleared: false }),
		clearTimeout: (handle) => {
			handle.cleared = true;
		}
	};
}

test('scheduling a name again replaces its timer', () => {
	const scheduler = new RetryScheduler({ timers: fakeTimers() });
	scheduler.schedule('a', 10, () => 1);
	const first = scheduler.handles.get('a');
	scheduler.schedule('a', 20, () => 2);
	assert.equal(first.cleared, true);
	assert.equal(scheduler.handles.get('a').ms, 20);
	assert.equal(scheduler.handles.get('a').fn(), 2);
	assert.equal(scheduler.handles.has('a'), false);
});

test('a failed step is logged and retried; a 429 waits for Retry-After', async () => {
	const lines = [];
	const scheduler = new RetryScheduler({ timers: fakeTimers(), retryDelayMs: 1000, logger: { error: (line) => lines.push(line) } });
	let attempts = 0;
	const step = async () => {
		attempts += 1;
		if (attempts === 1) {
			throw Object.assign(new Error('gaia token 429'), { status: 429, retryAfterSeconds: 90 });
		}
	};

	assert.equal(await scheduler.retry('token refresh', step), false);
	assert.equal(scheduler.handles.get('token refresh').ms, 90000);
	assert.match(lines[0], /token refresh failed \(gaia token 429\); retrying in 90s/);
	assert.equal(await scheduler.handles.get('token refresh').fn(), true);
	assert.equal(attempts, 2);
});

test('stop cancels timers and wakes sleepers; nothing is scheduled afterwards', async () => {
	const scheduler = new RetryScheduler({ timers: fakeTimers(), logger: { error: () => {} } });
	scheduler.schedule('a', 10, () => {});
	const handle = scheduler.handles.get('a');
	const sleeping = scheduler.sleep(1000);
	scheduler.stop();
	await sleeping;
	assert.equal(handle.cleared, true);
	scheduler.schedule('b', 10, () => {});
	assert.equal(scheduler.handles.size, 0);
	assert.equal(await scheduler.retry('c', async () => {
		throw new Error('x');
	}), false);
	assert.equal(scheduler.handles.size, 0);
});
