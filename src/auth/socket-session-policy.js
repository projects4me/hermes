const { RUNTIME_SERVICE_KIND, SERVICE_SCOPED_EVENTS } = require('../contract');

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
 * This function returns the service kind of a service token that may open a
 * socket: a runtime (D-020) or a kind with service-scoped events (D-024). It
 * returns null for any other session, delegated agent tokens included.
 *
 * @method socketServiceKind
 * @param {Object|null} session { userId, actorType, serviceKind, projectIds, expiresAt }
 * @returns {String|null}
 * @public
 */
function socketServiceKind(session) {
	if (!session || session.actorType !== 'service') {
		return null;
	}
	if (session.serviceKind !== RUNTIME_SERVICE_KIND && !SERVICE_SCOPED_EVENTS.has(session.serviceKind)) {
		return null;
	}
	return session.serviceKind;
}

/**
 * This function decides whether an introspected session may open a socket:
 * a user or agent actor with an id, a runtime service token, or a service
 * token of a kind with service-scoped events, whose token has not expired
 * yet. Other service tokens are refused.
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
	if (!isActor && !socketServiceKind(session)) {
		return false;
	}
	return Number.isFinite(session.expiresAt) && session.expiresAt > now;
}

module.exports = {
	SOCKET_ACTOR_TYPES,
	socketServiceKind,
	acceptsSocketSession
};
