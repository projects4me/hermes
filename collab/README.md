# collab — Projects4Me Docs collab server

A [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server that lets several browsers edit one Projects4Me doc
together. It holds each doc's Yjs document and awareness in memory, syncs them between the connected clients and
saves the document to Gaia. It is a separate process from the Hermes relay, with its own `package.json`,
Dockerfile and compose service, and shares no code with it (ADR D-022 in `../docs/architecture/decisions.md`).

## Contract

- **Document name:** `doc:<docId>`, where `docId` is a Gaia `Doc` id. Any other name is refused.
- **Token:** the client sends the user's Gaia OAuth access token as the Hocuspocus token.
- **Editor content:** the Y.XmlFragment `default` of the Y.Doc (Tiptap Collaboration's default field). Other
  shared types, such as a review `notes` map, are saved with the state but not rendered.

## Access

On connect the server calls Gaia with the client's token:

1. `GET /api/v1/user/me?include=aclPermissions`. A token Gaia refuses, or a user without an allowed `doc.get`
   permission, is refused.
2. `GET /api/v1/doc/<docId>`. A 401, 403 or 404 is refused.

The connection is **read-only** when the user has no allowed `doc.update` or the doc is `locked`. The server
drops updates from read-only connections.

When a browser sends an `Origin` header, it must be in `COLLAB_ALLOWED_ORIGINS` (when that list is set); otherwise
the WebSocket upgrade is refused with 403. Clients that send no `Origin` (not browsers) are let through to the
token check.

### Access changes while connected (ADR D-023)

Gaia tells the server when a doc's access changed. The server's HTTP routes (all under `/internal/`) are declared
in `src/http/routes.js`; each route's handler has its own module in `src/http/`.

```
POST /internal/docs/<docId>/access
X-Collab-Secret: <COLLAB_SECRET>
Content-Type: application/json

{"reason": "locked" | "unlocked" | "deleted" | "access"}
```

| Answer | When |
|---|---|
| `202` | Accepted; the re-check runs after the answer. |
| `400` | The body is not JSON or `reason` is not one of the four. |
| `413` | The body is over 4 KB. |
| `401` | The secret is missing or wrong (compared in constant time). |
| `404` / `405` | Another `/internal/` path / not `POST`. |

For every connection to `doc:<docId>` the server runs the connect checks again with that connection's own token,
one re-check of a doc at a time, and applies the answer:

- **Still allowed:** the connection becomes read-only or editable from Gaia's answer. When that changes, the
  client gets an `access` message. The server's writer tokens follow (a read-only connection's token no longer
  saves).
- **Refused** (401, 403 or 404, for example a token that has expired since connect): the connection is closed.
  With reason `deleted` the client first gets a `deleted` message.
- **Gaia unreachable or erroring:** the failure is logged. After `locked`, `deleted` or `access` the connection
  becomes read-only (fail closed) until a later call or a reconnect; after `unlocked` it keeps its access.
- **Gone:** a connection that closed while Gaia was answering is left alone.

Only Gaia's answer counts: the `reason` sent to the endpoint is passed on to clients but changes nothing by itself.

## Client messages (contract with Prometheus)

Stateless Hocuspocus messages (`onStateless`), each a JSON string:

| Message | Meaning |
|---|---|
| `{"type": "access", "readOnly": true, "reason": "locked"}` | This connection's access changed. `reason` is the one Gaia sent (`locked`, `unlocked`, `deleted` or `access`). From `readOnly: true` on, the server drops this client's updates. |
| `{"type": "deleted"}` | The doc was deleted; the connection is closed right after. |
| `{"type": "unsaved", "since": "2026-11-16T12:00:00.000Z"}` | Saving to Gaia has failed since `since`, for over 2 minutes. Also sent to clients that join while it lasts. |
| `{"type": "saved"}` | Gaia took the changes again after an `unsaved`. |

The server does not take back updates it dropped while a connection was read-only, and the client does not send
them again. A client that changed its document while read-only should reload the doc (a new Y.Doc) before
editing again.

Close codes:

| Code | Reason | Client |
|---|---|---|
| `4401` | `doc deleted` | The doc is gone. The Hocuspocus provider does not reconnect. |
| `4401` | `access lost` | Gaia no longer lets this token open the doc. The provider does not reconnect; reconnect with a fresh token if the user should still have access. |
| `1009` | `update too large` | A message was larger than `COLLAB_MAX_UPDATE_BYTES`. The provider does not reconnect. |
| `4429` | `too many updates` | More messages than `COLLAB_MAX_UPDATES_PER_SECOND`: document and awareness updates count, sync requests do not (token bucket, burst of the same size). The provider reconnects. |

## Persistence

Gaia's `Doccontent` resource is the only storage (Gaia Docs D-002 to D-004). The server writes with the token of
a connected user who has write access (Gaia Docs D-003); when Gaia refuses that token (401 or 403) it tries the
next writer, and the last writer who left is kept so the final save still has a token.

- **Load:** when the first client opens a doc, `GET /api/v1/doccontent?query=((Doccontent.docId : <docId>))` and
  the base64 `state` is applied. A doc without content starts empty.
- **Save:** about 2 s after a change (at most 10 s while changes keep coming), the state is encoded and the row is
  created (`POST /api/v1/doccontent`) or updated (`PATCH /api/v1/doccontent/<id>`) with `state` and `byteSize`
  (the length of the base64 state, which is how Gaia computes it).
- **Html and plain text:** after about 30 s without changes, and when the last client leaves, `html` and
  `plainText` are written too, rendered from the editor fragment with the schema below.
- **Retry:** a failed save is retried after 1 s, 2 s, 5 s, 10 s and then every 30 s while the doc is in memory,
  and a new change saves at once as usual. When saves have failed for 2 minutes the clients get `unsaved`, and
  `saved` once a save goes through.
- **Unload:** once it has been saved and nobody is connected, the doc is dropped from memory. A save that fails
  (Gaia down, or no writer token accepted) is logged and never stops the server; the save before unloading is
  retried twice (after 1 s and 5 s) unless someone reconnects, and a doc Gaia still refuses is unloaded with an
  error log saying its last edits were not taken.
- **Tokens:** writer tokens are the ones sent at connect; the server does not refresh them, so a writer whose
  token expires while connected is skipped (401) in favour of another writer.

Tokens and document content are never logged; log lines carry the doc id and Gaia status codes only.

## Schema (`src/schema.js`)

Matches the Prometheus Docs editor (Tiptap 2):

- StarterKit (history off: undo is Collaboration's), Underline, Link, Table, TableRow, TableHeader, TableCell,
  TaskList, TaskItem (nested).
- Marks `suggestionInsert` and `suggestionDelete`, with attributes `id`, `source`, `authorId`, `actedFor`,
  `requestId`, `reason`, `createdAt`. They render as `<ins data-suggestion-id="…">` and
  `<del data-suggestion-id="…">`; the other attributes render as `data-suggestion-<name in lower case>`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GAIA_URL` | (required) | Gaia origin, e.g. `http://localhost:8080` |
| `COLLAB_PORT` | `1234` | WebSocket and HTTP port (also serves the internal endpoint) |
| `COLLAB_SECRET` | `collab-dev-secret` in `development`/`test` | Shared secret of the internal endpoint. Required, and not the default, for any other `NODE_ENV` (missing `NODE_ENV` counts as `development`). Never logged. |
| `COLLAB_ALLOWED_ORIGINS` | (empty: every origin) | Comma-separated browser origins allowed to open a WebSocket, e.g. `http://localhost:4200` |
| `COLLAB_MAX_UPDATE_BYTES` | `524288` (512 KB) | Largest message a client may send |
| `COLLAB_MAX_UPDATES_PER_SECOND` | `60` | Document and awareness updates per second per connection |

## Run

```bash
# with the hermes compose file (port 1234, Gaia on the host's :8080)
docker compose up collab

# or directly (Node 18+)
cd collab
npm install
GAIA_URL=http://localhost:8080 npm start
```

## Test

`npm test` here runs the collab tests against an in-process stub Gaia. The root `npm test` of the repo runs the
relay tests and then these.

## Out of scope

Per-doc sharing changes, agents as server-side peers, version snapshots, comments and more than one
instance.
