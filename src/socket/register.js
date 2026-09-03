const { createAuthenticate } = require('./middleware/authenticate');
const { registerIntentHandlers } = require('./handlers/intents');

/**
 * This function attaches socket auth middleware and intents:set handlers.
 *
 * @method registerSocket
 * @param {Object} io Socket.IO server
 * @param {Object} deps Shared Hermes dependencies
 * @returns {void}
 * @public
 */
function registerSocket(io, deps) {
	io.use(createAuthenticate(deps));
	registerIntentHandlers(io, deps);
}

module.exports = { registerSocket };
