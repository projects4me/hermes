const MAX_TIMER_MS = 2147483647;

/**
 * This function returns a connection hook that disconnects a socket when its
 * token expires (`socket.data.expiresAt`, set by the auth middleware). The
 * client opens a new socket with its refreshed token; the timer is cleared
 * when the socket disconnects first.
 *
 * @method createExpiryDisconnect
 * @param {Object} deps
 * @param {Object} deps.counters In-memory counters
 * @param {Function} [deps.now] Clock in ms
 * @param {Object} [deps.timers] setTimeout/clearTimeout
 * @returns {Function} function(socket) → void
 * @public
 */
function createExpiryDisconnect({ counters, now = Date.now, timers = { setTimeout, clearTimeout } }) {
	return (socket) => {
		let timer = null;

		const arm = () => {
			const remaining = socket.data.expiresAt - now();
			if (!(remaining > 0)) {
				counters.auth.expired += 1;
				socket.disconnect(true);
				return;
			}
			timer = timers.setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
		};

		socket.once('disconnect', () => {
			if (timer) {
				timers.clearTimeout(timer);
				timer = null;
			}
		});
		arm();
	};
}

module.exports = { createExpiryDisconnect };
