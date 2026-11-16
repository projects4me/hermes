/**
 * Limits on what one connection may send: the size of each message and the
 * rate of document and awareness updates.
 */
const { IncomingMessage, MessageType } = require('@hocuspocus/server');
const { CLOSE_EVENTS } = require('./client-messages');

const DEFAULT_MAX_UPDATE_BYTES = 512 * 1024;
const DEFAULT_MAX_UPDATES_PER_SECOND = 60;
const SYNC_STEP_1 = 0;
const SYNC_TYPES = new Set([MessageType.Sync, MessageType.SyncReply]);

/**
 * This function tells whether a Hocuspocus message counts towards the rate
 * limit: every message but a sync request (Sync step 1), which carries no
 * change. Awareness counts too, since it is broadcast to every client.
 *
 * @method isCounted
 * @param {Uint8Array} data Raw message
 * @returns {Boolean}
 * @private
 */
function isCounted(data) {
	try {
		const message = new IncomingMessage(data);
		message.readVarString();
		if (!SYNC_TYPES.has(message.readVarUint())) {
			return true;
		}
		return message.readVarUint() !== SYNC_STEP_1;
	} catch (_error) {
		return true;
	}
}

/**
 * @class UpdateLimits
 * @public
 */
class UpdateLimits {
	/**
	 * @param {Object} options
	 * @param {Number} [options.maxUpdateBytes] Largest message accepted
	 * @param {Number} [options.maxUpdatesPerSecond] Updates per second per connection (also the burst)
	 */
	constructor({ maxUpdateBytes = DEFAULT_MAX_UPDATE_BYTES, maxUpdatesPerSecond = DEFAULT_MAX_UPDATES_PER_SECOND } = {}) {
		this.maxUpdateBytes = maxUpdateBytes;
		this.maxUpdatesPerSecond = maxUpdatesPerSecond;
		this.buckets = new WeakMap();
	}

	/**
	 * This function checks one incoming message of a connection.
	 *
	 * @method check
	 * @param {Object} connection Hocuspocus connection, the key of its rate bucket
	 * @param {Uint8Array} data Raw message
	 * @returns {Object|null} The close event for a message over a limit, or null
	 * @public
	 */
	check(connection, data) {
		if (data.length > this.maxUpdateBytes) {
			return CLOSE_EVENTS.updateTooLarge;
		}
		if (isCounted(data) && !this.take(connection)) {
			return CLOSE_EVENTS.tooManyUpdates;
		}
		return null;
	}

	/**
	 * This function takes one update from the connection's token bucket.
	 *
	 * @method take
	 * @param {Object} connection
	 * @returns {Boolean} False when the bucket is empty
	 * @private
	 */
	take(connection) {
		const now = Date.now();
		const bucket = this.buckets.get(connection) ?? { tokens: this.maxUpdatesPerSecond, at: now };
		bucket.tokens = Math.min(this.maxUpdatesPerSecond, bucket.tokens + ((now - bucket.at) / 1000) * this.maxUpdatesPerSecond);
		bucket.at = now;
		this.buckets.set(connection, bucket);
		if (bucket.tokens < 1) {
			return false;
		}
		bucket.tokens -= 1;
		return true;
	}
}

module.exports = { UpdateLimits, DEFAULT_MAX_UPDATE_BYTES, DEFAULT_MAX_UPDATES_PER_SECOND };
