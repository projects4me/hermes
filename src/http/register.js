const { requireSecret } = require('./middleware/require-secret');
const { createHealthHandler } = require('./routes/health');
const { createPublishHandler } = require('./routes/publish');

/**
 * This function mounts GET /health and POST /publish on the Express app.
 *
 * @method registerHttp
 * @param {Object} app Express app
 * @param {Object} deps Shared Hermes dependencies
 * @returns {void}
 * @public
 */
function registerHttp(app, deps) {
	app.get('/health', createHealthHandler(deps));
	app.post('/publish', requireSecret(deps), createPublishHandler(deps));
}

module.exports = { registerHttp };
