const { USER_ACCESS_CHANGED, userIdFromScope } = require('../contract');

/**
 * This function returns the hook POST /publish calls after emitting an
 * envelope: for `user.access.changed` it starts the user's access re-check
 * (D-021) without holding Gaia's publish request.
 *
 * @method createAccessChangeListener
 * @param {Object} deps
 * @param {Function} deps.recheckUserAccess From createAccessRecheck
 * @param {Object} deps.logger Logger with error()
 * @returns {Function} function(envelope) → Promise<void>|null
 * @public
 */
function createAccessChangeListener({ recheckUserAccess, logger }) {
	return (envelope) => {
		if (envelope.eventName !== USER_ACCESS_CHANGED) {
			return null;
		}
		const userId = userIdFromScope(envelope.projectId);
		if (!userId) {
			return null;
		}
		return recheckUserAccess(userId).catch((error) => {
			logger.error('access re-check failed', { userId, error: error.message });
		});
	};
}

module.exports = { createAccessChangeListener };
