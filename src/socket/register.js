const { createAuthenticate } = require('./middleware/authenticate');
const { createExpiryDisconnect } = require('./expiry');
const { registerIntentHandlers } = require('./handlers/intents');

/**
 * This function attaches socket auth middleware, the token-expiry
 * disconnect and the intents:set handlers.
 *
 * @method registerSocket
 * @param {Object} io Socket.IO server
 * @param {Object} deps Shared Hermes dependencies
 * @returns {void}
 * @public
 */
function registerSocket(io, deps) {
	io.use(createAuthenticate(deps));
	const disconnectAtExpiry = createExpiryDisconnect(deps);
	io.on('connection', disconnectAtExpiry);
	registerIntentHandlers(io, deps);
}

module.exports = { registerSocket };
