const http = require('http');

/**
 * In-process stub of the Gaia endpoints Hermes uses for its identity (D-015):
 * service enrollment, the token grant and secret rotation. It records every
 * request so tests can check what Hermes sent.
 *
 * @method startStubGaia
 * @param {Object} [options]
 * @param {String} [options.enrollmentToken] Token that approves a request at once
 * @param {Number} [options.expiresIn] Token lifetime in seconds
 * @returns {Promise<Object>} The stub: url, requests, state helpers, close()
 * @public
 */
async function startStubGaia({ enrollmentToken = 'enroll-token-1', expiresIn = 3600 } = {}) {
	const state = {
		requests: [],
		enrollments: new Map(),
		secrets: new Map([['hermes_stored', 'stored-secret']]),
		serviceClients: new Map([['sc-stored', 'hermes_stored']]),
		tokens: new Map(),
		tokenCount: 0,
		enrollmentStatus: null
	};

	function send(res, status, body, headers = {}) {
		res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
		res.end(JSON.stringify(body));
	}

	function enrollmentDocument(id, enrollment, extra = {}) {
		return {
			data: {
				type: 'serviceenrollment',
				id,
				attributes: {
					name: enrollment.name,
					kind: enrollment.kind,
					status: enrollment.status,
					userCode: enrollment.userCode,
					expiresAt: '2026-11-09 06:00:00',
					...extra
				}
			}
		};
	}

	function handle(req, res, raw) {
		const url = new URL(req.url, 'http://stub');
		state.requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body: raw });

		if (req.method === 'POST' && url.pathname === '/api/v1/serviceenrollment') {
			if (state.enrollmentStatus === 429) {
				return send(res, 429, { error: 'too many' }, { 'Retry-After': '120' });
			}
			const attributes = JSON.parse(raw).data.attributes;
			if (attributes.enrollmentToken && attributes.enrollmentToken !== enrollmentToken) {
				return send(res, 400, { errors: [{ detail: 'The enrollment token is not valid.' }] });
			}
			const id = `enr-${state.enrollments.size + 1}`;
			const enrollment = {
				name: attributes.name,
				kind: attributes.kind,
				status: attributes.enrollmentToken ? 'approved' : 'pending',
				userCode: 'ABC-DEF',
				pollToken: `poll-${id}`
			};
			state.enrollments.set(id, enrollment);
			return send(res, 201, enrollmentDocument(id, enrollment, { pollToken: enrollment.pollToken }));
		}

		const pollMatch = url.pathname.match(/^\/api\/v1\/serviceenrollment\/([^/]+)$/);
		if (req.method === 'GET' && pollMatch) {
			const enrollment = state.enrollments.get(pollMatch[1]);
			if (!enrollment || url.searchParams.get('pollToken') !== enrollment.pollToken) {
				return send(res, 404, { errors: [{ detail: 'not found' }] });
			}
			if (enrollment.status !== 'approved') {
				return send(res, 200, enrollmentDocument(pollMatch[1], enrollment));
			}
			enrollment.status = 'delivered';
			const clientId = `hermes_${pollMatch[1]}`;
			const serviceClientId = `sc-${pollMatch[1]}`;
			state.secrets.set(clientId, `secret-${pollMatch[1]}`);
			state.serviceClients.set(serviceClientId, clientId);
			return send(res, 200, enrollmentDocument(pollMatch[1], enrollment, {
				clientId,
				clientSecret: `secret-${pollMatch[1]}`,
				serviceClientId
			}));
		}

		if (req.method === 'POST' && url.pathname === '/api/v1/token') {
			const form = new URLSearchParams(raw);
			const clientId = form.get('client_id');
			if (form.get('grant_type') !== 'client_credentials' || state.secrets.get(clientId) !== form.get('client_secret')) {
				return send(res, 401, { error: 'invalid_client' });
			}
			state.tokenCount += 1;
			const accessToken = `access-${state.tokenCount}`;
			state.tokens.set(accessToken, clientId);
			return send(res, 200, { access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer', scope: 'token.introspect serviceclient.rotate' });
		}

		const rotateMatch = url.pathname.match(/^\/api\/v1\/serviceclient\/([^/]+)$/);
		if (req.method === 'PATCH' && rotateMatch) {
			const caller = state.tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
			const clientId = state.serviceClients.get(rotateMatch[1]);
			const body = JSON.parse(raw).data;
			if (!caller || caller !== clientId || body.id !== rotateMatch[1] || body.attributes.rotateSecret !== true) {
				return send(res, 401, { errors: [{ detail: 'denied' }] });
			}
			const secret = `${state.secrets.get(clientId)}-rotated`;
			state.secrets.set(clientId, secret);
			return send(res, 200, {
				data: {
					type: 'serviceclient',
					id: rotateMatch[1],
					attributes: { clientId, clientSecret: secret, previousSecretExpiresAt: '2026-11-09 06:10:00' }
				}
			});
		}

		return send(res, 404, { errors: [{ detail: 'no route' }] });
	}

	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => handle(req, res, raw));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

	return {
		url: `http://127.0.0.1:${server.address().port}`,
		state,
		requests: state.requests,
		approve(id) {
			state.enrollments.get(id).status = 'approved';
		},
		deny(id) {
			state.enrollments.get(id).status = 'denied';
		},
		close() {
			return new Promise((resolve) => server.close(resolve));
		}
	};
}

module.exports = { startStubGaia };
