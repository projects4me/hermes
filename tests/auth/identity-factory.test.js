const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/config');
const { createServiceIdentity } = require('../../src/auth/identity-factory');
const { ServiceIdentity } = require('../../src/auth/service-identity');

test('the identity is built only when a credential file is configured', () => {
	assert.equal(createServiceIdentity(loadConfig({})), null);
	const identity = createServiceIdentity(loadConfig({ HERMES_CREDENTIAL_FILE: '/tmp/hermes-credential.json' }));
	assert.ok(identity instanceof ServiceIdentity);
	assert.equal(identity.kind, 'hermes');
});
