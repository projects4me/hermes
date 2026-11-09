const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CredentialStore } = require('../../src/auth/credential-store');

function tempFile() {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-cred-')), 'credential.json');
}

test('a missing file means no stored credential', () => {
	assert.equal(new CredentialStore(tempFile()).load(), null);
});

test('save replaces the file atomically with mode 600 and only the known fields', () => {
	const file = tempFile();
	const store = new CredentialStore(file);
	store.save({ clientId: 'a', clientSecret: 'b', serviceClientId: 'c', secretIssuedAt: 'd', extra: 'x' });
	store.save({ clientId: 'a', clientSecret: 'b2', serviceClientId: 'c', secretIssuedAt: 'd2' });

	assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
		clientId: 'a', clientSecret: 'b2', serviceClientId: 'c', secretIssuedAt: 'd2'
	});
	assert.deepEqual(fs.readdirSync(path.dirname(file)), ['credential.json']);
	if (process.platform !== 'win32') {
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	}
});

test('a broken file is an error that does not echo its content', () => {
	const file = tempFile();
	fs.writeFileSync(file, '{"clientSecret": "s3cret"');
	assert.throws(() => new CredentialStore(file).load(), (error) => {
		assert.match(error.message, /not valid JSON/);
		assert.ok(!error.message.includes('s3cret'));
		return true;
	});

	fs.writeFileSync(file, '{"clientId": "a"}');
	assert.throws(() => new CredentialStore(file).load(), /has no clientId or clientSecret/);
});
