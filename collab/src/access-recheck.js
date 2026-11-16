/**
 * Re-checks every connection to a doc with Gaia when Gaia says the doc's
 * access changed (D-023), and applies the answer: read-only, editable or
 * closed, with a message telling the client why.
 */
const { AccessDenied } = require('./authenticator');
const { CLOSE_EVENTS, accessMessage, deletedMessage } = require('./client-messages');

/** Reasons after which a connection Gaia could not re-check must not keep editing. */
const FAIL_CLOSED_REASONS = new Set(['locked', 'deleted', 'access']);

/**
 * @class AccessRecheck
 * @public
 */
class AccessRecheck {
	/**
	 * @param {Object} options
	 * @param {Function} options.authenticate From createAuthenticator
	 * @param {Function} options.findDocument function(documentName) → the open Hocuspocus document, or undefined
	 * @param {Object} options.store ContentStore, whose writer tokens follow the connections' access
	 * @param {Object} [options.logger] console-like logger
	 */
	constructor({ authenticate, findDocument, store, logger = console }) {
		this.authenticate = authenticate;
		this.findDocument = findDocument;
		this.store = store;
		this.logger = logger;
		this.queues = new Map();
	}

	/**
	 * This function re-checks the connections of a doc, if it is open.
	 * Re-checks of one doc run one after the other, so an older Gaia answer
	 * never overrides a newer one, and each one looks the doc up when it
	 * starts.
	 *
	 * @method recheck
	 * @param {String} documentName
	 * @param {String} reason locked, unlocked, deleted or access
	 * @returns {Promise<void>}
	 * @public
	 */
	recheck(documentName, reason) {
		const run = (this.queues.get(documentName) ?? Promise.resolve()).then(() => {
			const document = this.findDocument(documentName);
			if (!document) {
				return null;
			}
			return Promise.all(document.getConnections().map((connection) => this.apply(document, connection, reason)));
		});
		const queued = run.catch(() => null).then(() => {
			if (this.queues.get(documentName) === queued) {
				this.queues.delete(documentName);
			}
		});
		this.queues.set(documentName, queued);
		return run.then(() => undefined);
	}

	/**
	 * @method apply
	 * @param {Document} document
	 * @param {Connection} connection
	 * @param {String} reason
	 * @returns {Promise<void>}
	 * @private
	 */
	async apply(document, connection, reason) {
		const documentName = document.name;
		const { token } = connection.context;
		let access;
		try {
			access = await this.authenticate({ token, documentName });
		} catch (error) {
			if (!document.hasConnection(connection)) {
				return;
			}
			if (error instanceof AccessDenied) {
				this.close(documentName, connection, reason);
			} else {
				this.logger.error(`collab: ${documentName} access not re-checked (${error.message})`);
				if (FAIL_CLOSED_REASONS.has(reason)) {
					this.setAccess(documentName, connection, false, reason);
				}
			}
			return;
		}
		if (document.hasConnection(connection)) {
			this.setAccess(documentName, connection, access.canWrite, reason);
		}
	}

	/**
	 * This function makes a connection editable or read-only, and tells the
	 * client when that changed.
	 *
	 * @method setAccess
	 * @param {String} documentName
	 * @param {Connection} connection
	 * @param {Boolean} canWrite
	 * @param {String} reason
	 * @private
	 */
	setAccess(documentName, connection, canWrite, reason) {
		const { token } = connection.context;
		connection.context.canWrite = canWrite;
		if (canWrite) {
			this.store.addWriter(documentName, connection.socketId, token);
		} else {
			this.store.removeWriter(documentName, token);
		}
		const readOnly = !canWrite;
		if (Boolean(connection.readOnly) !== readOnly) {
			connection.readOnly = readOnly;
			connection.sendStateless(accessMessage(readOnly, reason));
		}
	}

	/**
	 * This function closes a connection Gaia no longer lets in. Its updates
	 * are dropped from now on, even before the socket is closed.
	 *
	 * @method close
	 * @param {String} documentName
	 * @param {Connection} connection
	 * @param {String} reason
	 * @private
	 */
	close(documentName, connection, reason) {
		connection.readOnly = true;
		this.store.removeWriter(documentName, connection.context.token);
		if (reason === 'deleted') {
			connection.sendStateless(deletedMessage());
			connection.close(CLOSE_EVENTS.docDeleted);
		} else {
			connection.close(CLOSE_EVENTS.accessLost);
		}
	}
}

module.exports = { AccessRecheck };
