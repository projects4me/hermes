const { ServiceIdentity } = require('./service-identity');
const { CredentialStore } = require('./credential-store');
const { createGaiaIdentityClient } = require('./gaia-identity-client');

/**
 * This function builds Hermes's service identity from runtime config, or
 * returns null when no credential file is configured (identity off, D-019).
 *
 * @method createServiceIdentity
 * @param {Object} config Runtime config from loadConfig
 * @param {Object} [logger] Logger with info/error
 * @returns {ServiceIdentity|null}
 * @public
 */
function createServiceIdentity(config, logger = console) {
	const identity = config.identity || {};
	if (!identity.credentialFile) {
		return null;
	}
	return new ServiceIdentity({
		client: createGaiaIdentityClient({ gaiaUrl: config.gaiaUrl }),
		store: new CredentialStore(identity.credentialFile),
		logger,
		name: identity.serviceName,
		enrollmentToken: identity.enrollmentToken,
		pollIntervalMs: identity.pollIntervalMs,
		retryDelayMs: identity.retryDelayMs,
		rotationIntervalMs: identity.rotationIntervalMs
	});
}

module.exports = { createServiceIdentity };
