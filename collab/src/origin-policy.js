/**
 * Which browser origins may open a WebSocket to the collab server.
 */

/**
 * This function decides whether a WebSocket upgrade's `Origin` is allowed.
 * With no list configured every origin is. A request without `Origin` is not
 * from a browser and is allowed: only browsers send it, and the token check
 * still applies.
 *
 * @method isOriginAllowed
 * @param {String[]} allowedOrigins From COLLAB_ALLOWED_ORIGINS
 * @param {String|undefined} origin Request header
 * @returns {Boolean}
 * @public
 */
function isOriginAllowed(allowedOrigins, origin) {
	if (allowedOrigins.length === 0 || origin === undefined) {
		return true;
	}
	return allowedOrigins.includes(origin);
}

/**
 * This function refuses a WebSocket upgrade with 403 and closes its socket.
 *
 * @method refuseUpgrade
 * @param {Socket} socket
 * @public
 */
function refuseUpgrade(socket) {
	socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

module.exports = { isOriginAllowed, refuseUpgrade };
