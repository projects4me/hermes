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

const DEFAULT_TIMINGS = {
	debounceMs: 2000,
	maxDebounceMs: 10000,
	renderIdleMs: 30000,
	connectionTimeoutMs: 30000,
	finalSaveRetryMs: [1000, 5000]
};

/**
 * This function creates the collab server (not listening yet).
 *
 * @method createCollabServer
 * @param {Object} options
 * @param {String} options.gaiaUrl Gaia origin without a trailing slash
 * @param {Number} [options.port] Port to listen on
 * @param {Object} [options.timings] `debounceMs`, `maxDebounceMs`, `renderIdleMs`, `connectionTimeoutMs`,
 *   `finalSaveRetryMs` (waits before each retry of the save made before a doc is unloaded)
 * @param {Object} [options.logger] console-like logger
 * @returns {Hocuspocus}
 * @public
 */
function createCollabServer({ gaiaUrl, port, timings = {}, logger = console }) {
	const { debounceMs, maxDebounceMs, renderIdleMs, connectionTimeoutMs, finalSaveRetryMs } = {
		...DEFAULT_TIMINGS,
		...timings
	};
	const gaia = createGaiaClient({ gaiaUrl });
	const authenticate = createAuthenticator({ gaia });
	const store = new ContentStore({ gaia, logger });

	const saves = new SavePolicy({ store, finalSaveRetryMs, logger });

	const renders = new RenderScheduler({
		idleMs: renderIdleMs,
		onIdle: (documentName, document) => saves.trySave(documentName, document, true)
	});

	// One extension holds every hook: Hocuspocus 2 runs beforeUnloadDocument
	// only from extensions, not from the server configuration.
	const hooks = {
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

		async connected({ documentName, socketId, context }) {
			store.register(documentName, context);
			if (context.canWrite) {
				store.addWriter(documentName, socketId, context.token);
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
			store.forget(documentName);
		}
	};

	return new Hocuspocus({
		port,
		quiet: true,
		timeout: connectionTimeoutMs,
		debounce: debounceMs,
		maxDebounce: maxDebounceMs,
		unloadImmediately: true,
		stopOnSignals: false,
		extensions: [hooks]
	});
}

module.exports = { createCollabServer, DEFAULT_TIMINGS };
