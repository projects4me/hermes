const http = require('http');

/**
 * A stub Gaia for the collab tests: users by token with their ACL
 * permissions, docs, and Doccontent rows, served as JSON:API. It records
 * every request and can refuse Doccontent writes for a token.
 */
async function startStubGaia() {
	const users = new Map();
	const docs = new Map();
	const contents = new Map();
	const refusedWriters = new Map();
	const requests = [];
	let nextContentId = 1;

	function reply(res, status, body) {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(body === undefined ? '' : JSON.stringify(body));
	}

	function contentResource(row) {
		return { type: 'doccontent', id: row.id, attributes: { ...row.attributes } };
	}

	function handle(req, res, raw) {
		const url = new URL(req.url, 'http://gaia');
		const body = raw ? JSON.parse(raw) : undefined;
		requests.push({ method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body });
		const token = (req.headers.authorization || '').replace(/^Bearer /, '');
		const user = users.get(token);
		if (!user) {
			return reply(res, 401, { errors: [{ status: '401' }] });
		}
		if (req.method === 'GET' && url.pathname === '/api/v1/user/me') {
			return reply(res, 200, {
				data: { type: 'user', id: user.id, attributes: { email: `${user.id}@example.test` } },
				included: Object.entries(user.permissions).map(([entity, allowed], index) => ({
					type: 'userpermission', id: `perm-${index}`, attributes: { entity, allowed }
				}))
			});
		}
		const docMatch = /^\/api\/v1\/doc\/([^/]+)$/.exec(url.pathname);
		if (req.method === 'GET' && docMatch) {
			const doc = docs.get(docMatch[1]);
			if (!doc || (user.docIds && !user.docIds.includes(docMatch[1]))) {
				return reply(res, 404, { errors: [{ status: '404' }] });
			}
			return reply(res, 200, { data: { type: 'doc', id: docMatch[1], attributes: { ...doc } } });
		}
		if (url.pathname === '/api/v1/doccontent' && req.method === 'GET') {
			const docId = /Doccontent\.docId : ([^)\s]+)/.exec(url.searchParams.get('query') || '')?.[1];
			const rows = [...contents.values()].filter((row) => row.attributes.docId === docId);
			return reply(res, 200, { data: rows.map(contentResource) });
		}
		if (refusedWriters.has(token)) {
			return reply(res, refusedWriters.get(token), { errors: [{}] });
		}
		if (url.pathname === '/api/v1/doccontent' && req.method === 'POST') {
			const attributes = body.data.attributes;
			if ([...contents.values()].some((row) => row.attributes.docId === attributes.docId)) {
				return reply(res, 422, { errors: [{ status: '422' }] });
			}
			const row = { id: `content-${nextContentId++}`, attributes: { html: null, plainText: null, ...attributes } };
			contents.set(row.id, row);
			return reply(res, 201, { data: contentResource(row) });
		}
		const contentMatch = /^\/api\/v1\/doccontent\/([^/]+)$/.exec(url.pathname);
		if (contentMatch && req.method === 'PATCH') {
			const row = contents.get(contentMatch[1]);
			if (!row) {
				return reply(res, 404, { errors: [{ status: '404' }] });
			}
			Object.assign(row.attributes, body.data.attributes);
			return reply(res, 200, { data: contentResource(row) });
		}
		return reply(res, 404, { errors: [{ status: '404' }] });
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
		requests,
		contents,
		addUser(token, { id, permissions, docIds }) {
			users.set(token, { id, permissions, docIds });
		},
		addDoc(id, attributes) {
			docs.set(id, { projectId: 'project-1', locked: false, ...attributes });
		},
		addContent(attributes) {
			const row = { id: `content-${nextContentId++}`, attributes: { html: null, plainText: null, ...attributes } };
			contents.set(row.id, row);
			return row;
		},
		refuseWrites(token, status) {
			refusedWriters.set(token, status);
		},
		allowWrites(token) {
			refusedWriters.delete(token);
		},
		deleteContent(id) {
			contents.delete(id);
		},
		writes() {
			return requests.filter((request) => request.path.startsWith('/api/v1/doccontent') && request.method !== 'GET');
		},
		close() {
			server.closeAllConnections?.();
			return new Promise((resolve) => server.close(resolve));
		}
	};
}

/** Permissions of a user who may read and edit docs. */
const WRITER = { 'doc.get': 1, 'doc.update': 1, 'doccontent.get': 1, 'doccontent.create': 1, 'doccontent.update': 1 };

/** Permissions of a user who may only read docs. */
const READER = { 'doc.get': 1, 'doc.update': 0, 'doccontent.get': 1 };

module.exports = { startStubGaia, WRITER, READER };
