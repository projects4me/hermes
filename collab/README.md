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
drops updates from read-only connections. Access changes while a client is connected are not picked up yet.

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
| `COLLAB_PORT` | `1234` | WebSocket port |

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

Access changes while connected, agents as server-side peers, version snapshots, comments and more than one
instance.
