const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, corsOriginOption } = require('../src/config');

test('development config keeps local defaults', () => {
	const config = loadConfig({});
	assert.equal(config.nodeEnv, 'development');
	assert.equal(config.hermesSecret, 'hermes-dev-secret');
	assert.equal(config.corsOrigin, 'http://localhost:4200');
});

test('production config requires secret and origin', () => {
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production' }),
		/HERMES_SECRET is required when NODE_ENV is "production"/
	);
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production', HERMES_SECRET: 'prod-secret' }),
		/CORS_ORIGIN is required in production/
	);

	const config = loadConfig({
		NODE_ENV: 'production',
		HERMES_SECRET: 'prod-secret',
		CORS_ORIGIN: 'https://app.example'
	});
	assert.equal(config.hermesSecret, 'prod-secret');
	assert.equal(config.corsOrigin, 'https://app.example');
});

test('development CORS reflects the request origin', () => {
	assert.equal(corsOriginOption('http://localhost:4200', 'development'), true);
});

test('production CORS allows listed and loopback origins', async () => {
	const origin = corsOriginOption(
		'https://app.example,https://admin.example',
		'production'
	);
	assert.equal(typeof origin, 'function');

	const allowed = await new Promise((resolve, reject) => {
		origin('https://app.example', (error, value) => {
			if (error) {
				return reject(error);
			}
			resolve(value);
		});
	});
	assert.equal(allowed, true);

	const loopback = await new Promise((resolve, reject) => {
		origin('http://127.0.0.1:4200', (error, value) => {
			if (error) {
				return reject(error);
			}
			resolve(value);
		});
	});
	assert.equal(loopback, true);

	await assert.rejects(
		() => new Promise((resolve, reject) => {
			origin('https://evil.example', (error, value) => {
				if (error) {
					return reject(error);
				}
				resolve(value);
			});
		}),
		/origin not allowed/
	);
});

test('dev default secret applies only in development and test', () => {
	assert.equal(loadConfig({ NODE_ENV: 'test' }).hermesSecret, 'hermes-dev-secret');
	assert.equal(loadConfig({ NODE_ENV: 'development' }).hermesSecret, 'hermes-dev-secret');
});

test('other NODE_ENV values require a non-default secret', () => {
	for (const nodeEnv of ['staging', 'qa']) {
		assert.throws(() => loadConfig({ NODE_ENV: nodeEnv }), /HERMES_SECRET is required/);
		assert.throws(
			() => loadConfig({ NODE_ENV: nodeEnv, HERMES_SECRET: 'hermes-dev-secret' }),
			/must not be the development default/
		);
		assert.equal(loadConfig({ NODE_ENV: nodeEnv, HERMES_SECRET: 'real' }).hermesSecret, 'real');
	}
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production', HERMES_SECRET: 'hermes-dev-secret', CORS_ORIGIN: 'https://x' }),
		/must not be the development default/
	);
});
