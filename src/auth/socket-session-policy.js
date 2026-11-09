/**
 * Actor types that may open a normal socket (user sessions and agents,
 * delegated agent tokens included). Service tokens are refused: the
 * runtimes room they will use is a later change.
 *
 * @property SOCKET_ACTOR_TYPES
 * @type Array<String>
 * @public
 */
const SOCKET_ACTOR_TYPES = Object.freeze(['user', 'agent']);

/**
 * This function decides whether an introspected session may open a socket:
 * a user or agent actor with an id, whose token has not expired yet.
 *
 * @method acceptsSocketSession
 * @param {Object|null} session { userId, actorType, projectIds, expiresAt }
 * @param {Number} now Current time in ms
 * @returns {Boolean}
 * @public
 */
function acceptsSocketSession(session, now) {
	if (!session || !session.userId || !SOCKET_ACTOR_TYPES.includes(session.actorType)) {
		return false;
	}
	return Number.isFinite(session.expiresAt) && session.expiresAt > now;
}

module.exports = { SOCKET_ACTOR_TYPES, acceptsSocketSession };
