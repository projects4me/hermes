const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, DEV_SECRET } = require('../src/config');

const LIMITS = { maxUpdateBytes: 512 * 1024, maxUpdatesPerSecond: 60 };

test('GAIA_URL is required and loses its trailing slash; the port defaults to 1234', () => {
	assert.deepEqual(loadConfig({ GAIA_URL: 'http://gaia:8080/' }), {
		gaiaUrl: 'http://gaia:8080', port: 1234, secret: DEV_SECRET, allowedOrigins: [], limits: LIMITS
	});
	assert.equal(loadConfig({ GAIA_URL: 'https://gaia.test', COLLAB_PORT: '4321' }).port, 4321);
	assert.throws(() => loadConfig({}), /GAIA_URL/);
	assert.throws(() => loadConfig({ GAIA_URL: 'gaia:8080' }), /GAIA_URL/);
	assert.throws(() => loadConfig({ GAIA_URL: 'http://gaia', COLLAB_PORT: 'abc' }), /COLLAB_PORT/);
});

test('COLLAB_SECRET falls back to the development default only in development and test', () => {
	assert.equal(loadConfig({ GAIA_URL: 'http://gaia', NODE_ENV: 'test' }).secret, DEV_SECRET);
	assert.equal(loadConfig({ GAIA_URL: 'http://gaia', NODE_ENV: 'production', COLLAB_SECRET: 's3cret' }).secret, 's3cret');
	assert.throws(() => loadConfig({ GAIA_URL: 'http://gaia', NODE_ENV: 'production' }), /COLLAB_SECRET/);
	assert.throws(() => loadConfig({ GAIA_URL: 'http://gaia', NODE_ENV: 'staging', COLLAB_SECRET: DEV_SECRET }), /COLLAB_SECRET/);
});

test('allowed origins and limits are read from the environment', () => {
	const config = loadConfig({
		GAIA_URL: 'http://gaia',
		COLLAB_ALLOWED_ORIGINS: ' http://a.test , http://b.test,',
		COLLAB_MAX_UPDATE_BYTES: '1024',
		COLLAB_MAX_UPDATES_PER_SECOND: '10'
	});
	assert.deepEqual(config.allowedOrigins, ['http://a.test', 'http://b.test']);
	assert.deepEqual(config.limits, { maxUpdateBytes: 1024, maxUpdatesPerSecond: 10 });
	assert.throws(() => loadConfig({ GAIA_URL: 'http://gaia', COLLAB_MAX_UPDATE_BYTES: '0' }), /COLLAB_MAX_UPDATE_BYTES/);
});
