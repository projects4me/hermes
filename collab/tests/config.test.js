const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

test('GAIA_URL is required and loses its trailing slash; the port defaults to 1234', () => {
	assert.deepEqual(loadConfig({ GAIA_URL: 'http://gaia:8080/' }), { gaiaUrl: 'http://gaia:8080', port: 1234 });
	assert.deepEqual(loadConfig({ GAIA_URL: 'https://gaia.test', COLLAB_PORT: '4321' }), { gaiaUrl: 'https://gaia.test', port: 4321 });
	assert.throws(() => loadConfig({}), /GAIA_URL/);
	assert.throws(() => loadConfig({ GAIA_URL: 'gaia:8080' }), /GAIA_URL/);
	assert.throws(() => loadConfig({ GAIA_URL: 'http://gaia', COLLAB_PORT: 'abc' }), /COLLAB_PORT/);
});
