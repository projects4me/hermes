/**
 * Introspection answers shaped like Gaia's `TokenIntrospection` (Gaia D-065),
 * for the stub Gaia.
 */

function activeAnswer(overrides = {}) {
	return {
		active: true,
		token_type: 'Bearer',
		clientId: 'prometheus',
		scope: null,
		exp: Math.floor(Date.now() / 1000) + 3600,
		sub: 'user-1',
		actorType: 'user',
		act: null,
		projectIds: ['project-1'],
		serviceKind: null,
		...overrides
	};
}

function serviceAnswer(overrides = {}) {
	return activeAnswer({
		clientId: 'svc_other',
		scope: 'token.introspect',
		sub: null,
		actorType: 'service',
		projectIds: [],
		serviceKind: 'runtime',
		...overrides
	});
}

module.exports = { activeAnswer, serviceAnswer };
