const fs = require('fs');
const path = require('path');

const FIELDS = ['clientId', 'clientSecret', 'serviceClientId', 'secretIssuedAt'];

/**
 * Keeps Hermes's own service credential in one JSON file (D-019): the client
 * id, secret, Serviceclient record id and when the secret was issued. It is
 * Hermes's configuration, not domain storage. The file is written to a temp
 * file with mode 600 and renamed over the old one, so a crash never leaves a
 * half-written credential.
 *
 * @class CredentialStore
 * @public
 */
class CredentialStore {
	/**
	 * @param {String} filePath Path of the credential file
	 */
	constructor(filePath) {
		this.filePath = filePath;
	}

	/**
	 * This function reads the stored credential.
	 *
	 * @method load
	 * @returns {Object|null} The credential, or null when there is no file
	 * @throws {Error} When the file exists but is not a valid credential
	 * @public
	 */
	load() {
		let raw;
		try {
			raw = fs.readFileSync(this.filePath, 'utf8');
		} catch (error) {
			if (error.code === 'ENOENT') {
				return null;
			}
			throw error;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (_error) {
			throw new Error(`credential file ${this.filePath} is not valid JSON`);
		}
		if (!parsed || !parsed.clientId || !parsed.clientSecret) {
			throw new Error(`credential file ${this.filePath} has no clientId or clientSecret`);
		}
		return {
			clientId: parsed.clientId,
			clientSecret: parsed.clientSecret,
			serviceClientId: parsed.serviceClientId || null,
			secretIssuedAt: parsed.secretIssuedAt || null
		};
	}

	/**
	 * This function replaces the stored credential atomically, mode 600.
	 *
	 * @method save
	 * @param {Object} credential Credential to store
	 * @returns {void}
	 * @public
	 */
	save(credential) {
		const record = {};
		for (const field of FIELDS) {
			record[field] = credential[field] ?? null;
		}
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${process.pid}.tmp`;
		// A temp file left by a crash keeps its old mode, so start from a new one.
		fs.rmSync(tempPath, { force: true });
		try {
			const fd = fs.openSync(tempPath, 'wx', 0o600);
			try {
				fs.writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
				fs.fsyncSync(fd);
			} finally {
				fs.closeSync(fd);
			}
			fs.renameSync(tempPath, this.filePath);
		} catch (error) {
			fs.rmSync(tempPath, { force: true });
			throw error;
		}
	}
}

module.exports = { CredentialStore };
