/**
 * The tokens of users who may write one doc, in the order the store tries
 * them: connected writers first (latest first), then writers who have left,
 * so the save on the last disconnect still has a token. Held in memory only
 * and dropped when the doc is unloaded.
 *
 * @class WriterTokens
 * @public
 */
class WriterTokens {
	constructor() {
		this.connected = new Map();
		this.gone = [];
	}

	/**
	 * @method add
	 * @param {String} socketId
	 * @param {String} token
	 * @public
	 */
	add(socketId, token) {
		this.connected.delete(socketId);
		this.connected.set(socketId, token);
	}

	/**
	 * This function keeps a leaving writer's token as a fallback.
	 *
	 * @method leave
	 * @param {String} socketId
	 * @public
	 */
	leave(socketId) {
		const token = this.connected.get(socketId);
		if (token === undefined) {
			return;
		}
		this.connected.delete(socketId);
		this.gone = [token, ...this.gone.filter((goneToken) => goneToken !== token)];
	}

	/**
	 * This function drops a token Gaia refused, so it is not tried again.
	 *
	 * @method drop
	 * @param {String} token
	 * @public
	 */
	drop(token) {
		for (const [socketId, connectedToken] of this.connected) {
			if (connectedToken === token) {
				this.connected.delete(socketId);
			}
		}
		this.gone = this.gone.filter((goneToken) => goneToken !== token);
	}

	/**
	 * @method ordered
	 * @returns {Array<String>} Distinct tokens, in the order to try them
	 * @public
	 */
	ordered() {
		return [...new Set([...[...this.connected.values()].reverse(), ...this.gone])];
	}
}

module.exports = { WriterTokens };
