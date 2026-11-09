/**
 * Actor types that may open a normal socket (user sessions and agents,
 * delegated agent tokens included).
 *
 * @property SOCKET_ACTOR_TYPES
 * @type Array<String>
 * @public
 */
const SOCKET_ACTOR_TYPES = Object.freeze(['user', 'agent']);

/**
 * The service kind whose service tokens may open a runtimes socket (D-020).
 *
 * @property RUNTIME_SERVICE_KIND
 * @type String
 * @public
 */
const RUNTIME_SERVICE_KIND = 'runtime';

/**
 * This function tells whether an introspected session is a Talos runtime:
 * a service token (not a delegated agent token) of service kind runtime.
 *
 * @method isRuntimeSession
 * @param {Object|null} session { userId, actorType, serviceKind, projectIds, expiresAt }
 * @returns {Boolean}
 * @public
 */
function isRuntimeSession(session) {
	return Boolean(session)
		&& session.actorType === 'service'
		&& session.serviceKind === RUNTIME_SERVICE_KIND;
}

/**
 * This function decides whether an introspected session may open a socket:
 * a user or agent actor with an id, or a runtime service token, whose token
 * has not expired yet. Other service tokens are refused.
 *
 * @method acceptsSocketSession
 * @param {Object|null} session { userId, actorType, serviceKind, projectIds, expiresAt }
 * @param {Number} now Current time in ms
 * @returns {Boolean}
 * @public
 */
function acceptsSocketSession(session, now) {
	if (!session) {
		return false;
	}
	const isActor = Boolean(session.userId) && SOCKET_ACTOR_TYPES.includes(session.actorType);
	if (!isActor && !isRuntimeSession(session)) {
		return false;
	}
	return Number.isFinite(session.expiresAt) && session.expiresAt > now;
}

module.exports = {
	SOCKET_ACTOR_TYPES,
	RUNTIME_SERVICE_KIND,
	isRuntimeSession,
	acceptsSocketSession
};
