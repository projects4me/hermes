/**
 * This function answers a request with a JSON body, unless an answer was
 * already sent.
 *
 * @method reply
 * @param {ServerResponse} response
 * @param {Number} status
 * @param {Object} [body] JSON body
 * @param {Object} [headers] Extra headers
 * @public
 */
function reply(response, status, body, headers = {}) {
	if (response.headersSent) {
		return;
	}
	response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
	response.end(body === undefined ? '' : JSON.stringify(body));
}

module.exports = { reply };
