/**
 * The collab server's HTTP routes, served on the Hocuspocus port next to the
 * WebSocket upgrades. Every route lives under `/internal/`; other paths are
 * left to Hocuspocus.
 */
const { reply } = require('./reply');
const { createAccessChangeHandler } = require('./access-change');

const PREFIX = '/internal/';

/**
 * This function returns the route table: method, path pattern (named groups
 * become the handler's params) and handler.
 *
 * @method routeTable
 * @param {Object} deps
 * @param {String} deps.secret Shared secret (COLLAB_SECRET, D-023)
 * @param {Function} deps.onAccessChange function(docId, reason)
 * @returns {Object[]}
 * @private
 */
function routeTable({ secret, onAccessChange }) {
	return [
		{
			method: 'POST',
			path: /^\/internal\/docs\/(?<docId>[A-Za-z0-9-]{1,64})\/access$/,
			handler: createAccessChangeHandler({ secret, onAccessChange })
		}
	];
}

/**
 * This function returns the router of the collab server's HTTP routes.
 * Under `/internal/` an unknown path gets 404 and a known path with another
 * method 405.
 *
 * @method createRoutes
 * @param {Object} deps
 * @param {String} deps.secret Shared secret (COLLAB_SECRET, D-023)
 * @param {Function} deps.onAccessChange function(docId, reason), started without waiting for it
 * @returns {Function} Async function(request, response) → whether a route answered the request
 * @public
 */
function createRoutes(deps) {
	const routes = routeTable(deps);

	return async function handle(request, response) {
		const path = (request.url || '').split('?')[0];
		if (!path.startsWith(PREFIX)) {
			return false;
		}
		const matches = routes
			.map((route) => ({ route, match: route.path.exec(path) }))
			.filter(({ match }) => match);
		const found = matches.find(({ route }) => route.method === request.method);
		try {
			if (found) {
				await found.route.handler(request, response, { ...found.match.groups });
			} else if (matches.length) {
				request.resume();
				const allow = matches.map(({ route }) => route.method).join(', ');
				reply(response, 405, { error: 'method not allowed' }, { Allow: allow });
			} else {
				request.resume();
				reply(response, 404, { error: 'not found' });
			}
		} catch (_error) {
			reply(response, 500, { error: 'internal error' });
		}
		return true;
	};
}

module.exports = { createRoutes };
