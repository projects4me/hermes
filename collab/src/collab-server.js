/**
 * Wires the collab server's Hocuspocus hooks to the authenticator and the
 * content store. Hocuspocus holds the Yjs documents and awareness in memory
 * and syncs them between clients (D-022).
 */
const Y = require('yjs');
const { Hocuspocus } = require('@hocuspocus/server');
const { createGaiaClient } = require('./gaia-client');
const { createAuthenticator } = require('./authenticator');
const { ContentStore } = require('./content-store');
const { RenderScheduler } = require('./render-scheduler');
const { SavePolicy } = require('./save-policy');
const { SaveHealth } = require('./save-health');
const { SaveRetry } = require('./save-retry');
const { AccessRecheck } = require('./access-recheck');
const { UpdateLimits } = require('./update-limits');
const { createInternalEndpoint } = require('./internal-endpoint');
const { isOriginAllowed, refuseUpgrade } = require('./origin-policy');
const { documentNameOf } = require('./access');

const DEFAULT_TIMINGS = {
	debounceMs: 2000,
	maxDebounceMs: 10000,
	renderIdleMs: 30000,
	connectionTimeoutMs: 30000,
	finalSaveRetryMs: [1000, 5000],
	saveRetryMs: [1000, 2000, 5000, 10000, 30000],
	unsavedAfterMs: 120000
};

/**
 * Stops later hooks and Hocuspocus' default handling of a request or an
 * upgrade the hook has answered: Hocuspocus ignores a rejection without an
 * error.
 *
 * @method handled
 * @returns {Promise<never>}
 * @private
 */
function handled() {
	return Promise.reject();
}

/**
 * This function creates the collab server (not listening yet).
 *
 * @method createCollabServer
 * @param {Object} options
 * @param {String} options.gaiaUrl Gaia origin without a trailing slash
 * @param {Number} [options.port] Port to listen on
 * @param {String} options.secret Shared secret of the internal endpoint (D-023)
 * @param {String[]} [options.allowedOrigins] Browser origins allowed to connect; empty allows all
 * @param {Object} [options.limits] `maxUpdateBytes`, `maxUpdatesPerSecond`
 * @param {Object} [options.timings] `debounceMs`, `maxDebounceMs`, `renderIdleMs`, `connectionTimeoutMs`,
 *   `finalSaveRetryMs` (waits before each retry of the save made before a doc is unloaded),
 *   `saveRetryMs` (back-off of a failed save), `unsavedAfterMs` (failing time before clients are told)
 * @param {Object} [options.logger] console-like logger
 * @returns {Hocuspocus}
 * @public
 */
function createCollabServer({ gaiaUrl, port, secret, allowedOrigins = [], limits = {}, timings = {}, logger = console }) {
	const {
		debounceMs, maxDebounceMs, renderIdleMs, connectionTimeoutMs, finalSaveRetryMs, saveRetryMs, unsavedAfterMs
	} = { ...DEFAULT_TIMINGS, ...timings };
	const gaia = createGaiaClient({ gaiaUrl });
	const authenticate = createAuthenticator({ gaia });
	const store = new ContentStore({ gaia, logger });
	const updateLimits = new UpdateLimits(limits);

	// Set below; the callbacks only run once the server is up.
	let server;
	const findDocument = (documentName) => server.documents.get(documentName);
	const recheck = new AccessRecheck({ authenticate, findDocument, store, logger });
	const broadcast = (documentName, message) => findDocument(documentName)?.broadcastStateless(message);
	const health = new SaveHealth({ unsavedAfterMs, notify: broadcast });
	const retry = new SaveRetry({ retryMs: saveRetryMs });
	const saves = new SavePolicy({ store, finalSaveRetryMs, retry, health, logger });

	const internalEndpoint = createInternalEndpoint({
		secret,
		onAccessChange: (docId, reason) => {
			const documentName = documentNameOf(docId);
			recheck.recheck(documentName, reason).catch((error) => {
				logger.error(`collab: ${documentName} access not re-checked (${error.message})`);
			});
		}
	});

	const renders = new RenderScheduler({
		idleMs: renderIdleMs,
		onIdle: (documentName, document) => saves.trySave(documentName, document, true)
	});

	// One extension holds every hook: Hocuspocus 2 runs beforeUnloadDocument
	// only from extensions, not from the server configuration.
	const hooks = {
		async onRequest({ request, response }) {
			if (await internalEndpoint(request, response)) {
				return handled();
			}
		},

		async onUpgrade({ request, socket }) {
			if (!isOriginAllowed(allowedOrigins, request.headers.origin)) {
				refuseUpgrade(socket);
				return handled();
			}
		},

		async beforeHandleMessage({ documentName, connection, update }) {
			const closeEvent = updateLimits.check(connection, update);
			if (closeEvent) {
				logger.error(`collab: ${documentName} connection closed (${closeEvent.reason})`);
				// Hocuspocus closes the connection with the code and reason of what is thrown.
				throw { ...closeEvent };
			}
		},

		async onAuthenticate({ token, documentName, connection }) {
			const access = await authenticate({ token, documentName });
			connection.readOnly = !access.canWrite;
			return { ...access, token };
		},

		async onLoadDocument({ documentName, document, context }) {
			store.open(documentName, context);
			const state = await store.load(documentName, context.token);
			if (state) {
				Y.applyUpdate(document, state);
			}
		},

		async connected({ documentName, socketId, context, connectionInstance }) {
			store.register(documentName, context);
			if (context.canWrite) {
				store.addWriter(documentName, socketId, context.token);
			}
			const unsaved = health.pendingMessage(documentName);
			if (unsaved) {
				connectionInstance.sendStateless(unsaved);
			}
		},

		async onChange({ documentName, document, socketId }) {
			if (socketId) {
				renders.changed(documentName, document);
			}
		},

		async onStoreDocument({ documentName, document }) {
			await saves.trySave(documentName, document, false);
		},

		async onDisconnect({ documentName, socketId }) {
			store.leave(documentName, socketId);
		},

		async beforeUnloadDocument({ instance, documentName }) {
			const document = instance.documents.get(documentName);
			if (!document || document.isLoading || !store.has(documentName)) {
				return;
			}
			renders.cancel(documentName);
			await saves.saveBeforeUnload(documentName, document);
		},

		async afterUnloadDocument({ instance, documentName }) {
			if (instance.documents.has(documentName)) {
				return;
			}
			renders.cancel(documentName);
			saves.forget(documentName);
			store.forget(documentName);
		}
	};

	server = new Hocuspocus({
		port,
		quiet: true,
		timeout: connectionTimeoutMs,
		debounce: debounceMs,
		maxDebounce: maxDebounceMs,
		unloadImmediately: true,
		stopOnSignals: false,
		extensions: [hooks]
	});
	return server;
}

module.exports = { createCollabServer, DEFAULT_TIMINGS };
