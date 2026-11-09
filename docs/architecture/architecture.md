# Hermes

Hermes is a locked realtime relay. It authenticates sockets against Gaia,
accepts an intent snapshot, validates publish envelopes, and emits
`domain:event` on internal composite rooms. It does not know issues, boards,
or comments.

Decisions for this repo: `decisions.md` in this folder.
Gaia publishing: sibling repo `gaia/docs/architecture/live-updates/`.
Prometheus consumption: sibling repo `prometheus/docs/architecture/live-updates/`.

```
Browser A / curl / other tab
        │
        │  PATCH /api/v1/issue/{id}
        ▼
     Gaia save
        │
        │  POST /publish   X-Hermes-Secret
        │  { schemaVersion, eventId, eventName, projectId, resource, changes }
        ▼
     Hermes
        │  io.to(v1:intent:<projectId>:<eventName>).emit('domain:event')
        ▼
  sockets that sent intents:set for that pair
        │
        ▼
  Prometheus hermes.register() handlers
```

## Ownership

| Process | Job |
|---|---|
| **Gaia** | Source of truth. After a successful persist, POST a domain-event envelope to Hermes. Fail open. Never names Socket.IO rooms. |
| **Hermes** | Authenticate sockets against Gaia, accept an intent snapshot, validate envelopes, emit `domain:event`. |
| **Prometheus** | One socket per session. Routes and services register the events they can apply. |

## Gaia ingest

`POST /publish` with `X-Hermes-Secret` (or Bearer shared secret):

```json
{
  "schemaVersion": 1,
  "eventId": "event-uuid",
  "eventName": "issue.status.changed",
  "occurredAt": "2026-08-20T10:00:00Z",
  "projectId": "project-uuid",
  "resource": { "type": "issue", "id": "issue-uuid" },
  "actorId": "user-uuid",
  "changes": { "status": "closed" },
  "meta": { "source": "gaia" }
}
```

`projectId` is a project id for work events. User-scoped notifications use
`user:<userId>` in that field so the existing composite-room key routes only
to that recipient. `actorId` may be `null`. Unknown fields and names outside
the allowlist are rejected.

Gaia publishes from controller-attached components in
`app/api/v1/controllers/components/events/`. Contract and HTTP helpers live
in `events/support/`:

- `IssueLiveEventsComponent`
- `MilestoneLiveEventsComponent`
- `ConversationCommentLiveEventsComponent`
- `ConversationVoteLiveEventsComponent`
- `ConversationLiveEventsComponent`

Notifications are nested model saves, so `NotificationLiveEvents` is invoked
from `Systemnotificationrecipient::afterCreate`. All of them share
`HermesPublisher` (`POST /publish`) and `EventNames`.

## Client contract

The client authenticates its Socket.IO handshake with `auth.token` (or an
`Authorization: Bearer` header). Hermes checks that token with one Gaia
introspection call made with its own service token (D-002): user and agent
tokens are accepted, service tokens refused, and the socket is disconnected
(`io server disconnect`) when the token expires, so the client reconnects with
its refreshed token. When Gaia publishes `user.access.changed` for a user,
Hermes evicts that user's cached sessions and introspects each of their
sockets again (D-020): a socket whose token is no longer active (or whose
re-check cannot reach Gaia) is disconnected the same way, and any other socket
leaves the rooms of projects it is no longer a member of. The client then
emits:

```json
{
  "protocolVersion": 1,
  "revision": 7,
  "intents": [
    { "projectId": "project-uuid", "eventName": "issue.status.changed" }
  ]
}
```

Allowlisted `eventName` values:

- `issue.status.changed`
- `issue.assignee.changed`
- `milestone.created`
- `milestone.completed`
- `issue.created`
- `issue.dates.changed`
- `issue.dependency.created`
- `issue.dependency.deleted`
- `conversation.comment.created`
- `conversation.comment.updated`
- `conversation.comment.deleted`
- `conversation.vote.added`
- `conversation.vote.removed`
- `conversation.created`
- `notification.created`
- `workflow.agent.run.requested`

`revision` is a nonnegative integer and must be greater than the last accepted
revision on that socket. There may be at most 100 intents. Hermes checks every
`projectId` against the authenticated socket's memberships (or
`user:<socketUserId>` for the user-scoped events `notification.created` and
`workflow.agent.run.requested`), deduplicates accepted
intents, and replaces that socket's composite rooms only after the full
request is validated. Room keys are internal.

Hermes acknowledges every request with `{ revision, accepted, rejected }`.
Reconnect creates a new socket with revision `-1` and no intents, so the
client must send its current set again.

Intents are stored **per Socket.IO connection**, not per user. Closing a tab
removes that socket from every composite room automatically.

`GET /health` reports socket, auth-cache, auth, intent, publish, and access
re-check counters.
Auth cache TTL and size are configured with `AUTH_CACHE_TTL_MS` and
`AUTH_CACHE_MAX_ENTRIES`.

## Prometheus

After login, `loading-assets` (and `app` if assets already loaded):

1. `hermes.connect()` with `auth.token`
2. `notifications.startLiveSync()` — registers `notification.created` for `user:<me>`

Logout: `notifications.stopLiveSync()`, `hermes.disconnect()`.

Mounted routes call `registerHermesIntents(projectId)` and dispose on exit:

| Screen | Events |
|---|---|
| Board | issue status/assignee/created, milestone created/completed |
| Gantt | issue dates/dependencies/assignee/created |
| Conversations | comment, vote, conversation.created |

The REST adapter calls `hermes.noteLocalWrite(type, id)` so the saving tab
drops its own echo.

## Config

| Env | Typical Docker value | Used by |
|---|---|---|
| `HERMES_URL` | `http://host.docker.internal:9000` (OG Gaia) / `:9001` (gaia-test → hermes-test) | Gaia → Hermes ingest |
| `HERMES_SECRET` | shared secret | Gaia `X-Hermes-Secret`, Hermes `/publish` |
| `GAIA_URL` | `http://host.docker.internal:8080` (hermes) / `:8081` (hermes-test) | Hermes socket auth (`POST /api/v1/introspect` with Hermes's service token, D-002) |
| `CORS_ORIGIN` | Ember origin | Hermes CORS in production |
| `AUTH_CACHE_TTL_MS` | `300000` | Socket session cache |
| `AUTH_CACHE_MAX_ENTRIES` | `1000` | Socket session cache |
| `HERMES_CREDENTIAL_FILE` | `/var/lib/hermes/credential.json` (mounted volume) | Hermes service identity (D-019); unset = identity off and every socket handshake refused |
| `GAIA_ENROLLMENT_TOKEN` | single-use token from an admin | First enrollment without approval by user code (D-019) |
| `HERMES_SERVICE_NAME` | `Hermes <hostname>` | Name shown to the admin on the enrollment request |
| `HERMES_ENROLLMENT_POLL_MS` | `5000` | Wait between enrollment polls |
| `HERMES_IDENTITY_RETRY_MS` | `60000` | Wait before retrying a failed enrollment, token or rotation |
| `HERMES_SECRET_ROTATION_MS` | `604800000` (7 days) | Secret age at which Hermes rotates it |

Local compose runs two Hermes services: `hermes` on `:9000` (auth against OG Gaia `:8080`) and `hermes-test` on `:9001` (auth against `gaia-test` `:8081`) for api-tester live mode.

## Service identity

Hermes can hold its own Gaia identity (D-019): it enrolls as a service client, keeps a `client_credentials` token and rotates its secret. It is **off unless `HERMES_CREDENTIAL_FILE` is set**. `POST /publish` and `/health` never depend on it: if enrollment fails, Hermes logs `Hermes service identity: start failed (...); retrying in Ns` and retries every `HERMES_IDENTITY_RETRY_MS`; it does not crash or reject. This is covered by `tests/start-hermes.test.js` (Gaia unreachable, enrollment 404 or 500, broken or unreadable credential file). Socket auth does need it: handshakes are checked through Gaia introspection with the service token (D-002), so until the identity has a token every handshake is refused.

Deploy settings (the helm chart, `values-dev.yaml`, lives on the OVH server, not in this repo; set these there):

1. **Persistent volume.** Mount a volume that survives restarts and set `HERMES_CREDENTIAL_FILE` to a file on it (for example `/var/lib/hermes/credential.json`). Without it Hermes enrolls again on every restart and leaves orphan service clients in Gaia. The process user must be able to create and write the file (it is stored with restricted permissions).
2. **First enrollment.** Either set `GAIA_ENROLLMENT_TOKEN` to a single-use token an admin created in Gaia (approved at once), or leave it unset: Hermes logs a user code once and an admin approves the request in Gaia, within the enrollment timeout (about 16 minutes), after which Hermes starts a new request. Remove the token from the values once the credential file exists; it is only read when there is no stored credential.
3. **Name.** `HERMES_SERVICE_NAME` is what the admin sees on the request. Set a stable name per deployment (the default is `Hermes <hostname>`, which changes with the pod).
4. **Gaia must expose** `POST /api/v1/serviceenrollment`, `GET /api/v1/serviceenrollment/{id}`, `POST /api/v1/token` and `PATCH /api/v1/serviceclient/{id}`. Until it does, Hermes only logs the retry.
5. **Tuning (optional).** `HERMES_ENROLLMENT_POLL_MS`, `HERMES_IDENTITY_RETRY_MS`, `HERMES_SECRET_ROTATION_MS`: see the Config table.
6. **Secrets.** The secret, token and poll token are never logged; keep the credential file out of images and backups you share.

## Key files

| Area | Path |
|---|---|
| Entry | `server.js` |
| Start-up wiring | `src/start-hermes.js` |
| Composition | `src/app.js` |
| HTTP | `src/http/` |
| Sockets | `src/socket/` |
| Contract | `src/contract/` |
| Intents | `src/intents/` |
| Auth | `src/auth/` |
| Gaia publisher | `gaia/app/api/v1/controllers/components/events/support/HermesPublisher.php` |
| Gaia event names | `gaia/app/api/v1/controllers/components/events/support/EventNames.php` |
| Gaia Hermes config | `gaia/config/hermes.php` |
| Ember socket | `prometheus/app/services/hermes.js` |
| Ember live URL | `prometheus/app/utils/live/url.js` |
| Session start | `prometheus/app/routes/app/loading-assets.js`, `prometheus/app/routes/app.js` |
| Logout | `prometheus/app/controllers/app.js` |

`EventNames` must stay in lockstep with `src/contract/names.js`.

## Testing

Hermes tests run with `node --test` against an in-process `createHermesApp`
and a stub `loadSession`. They do not start Gaia or Prometheus. Gaia publish
rules and api-tester live mode stay in the Gaia repo. Decision D-015 in
`decisions.md` records why.

```
node --test
  ├─ tests/app.test.js          → HTTP publish + Socket.IO intents
  └─ tests/{auth,contract,intents,config}  → unit rules
```

Constraints: **no Gaia**, **no Prometheus**, stub the Gaia session loader.

### App tests (`tests/app.test.js`)

| Test | Covers |
|---|---|
| Matching domain events | Valid envelope reaches only sockets that registered that pair |
| Legacy ingest gone | `POST /events` and `POST /broadcast` are 404 |
| Zero subscribers | Valid publish is still 200; `zeroSubscribers` counter increments |
| Two sockets, one user | Each connection receives only its registered event names |
| Reconnect | New socket starts at revision `-1`; same revision can be sent again |
| Disconnect | Closed socket leaves rooms; remaining socket still receives |
| User-scoped notifications | `notification.created` with `user:<id>` reaches only that user |
| User-scoped agent runs | `workflow.agent.run.requested` with `user:<agentUserId>` reaches only that user; a project scope is `project_not_authorized` |
| Foreign user scope | Intent `user:<otherId>` is `project_not_authorized` |

### Unit tests

| File | Covers |
|---|---|
| `tests/contract/envelope.test.js` | Closed envelope schema, allowlist, extra keys |
| `tests/contract/names.test.js` | Allowlist and user-scoped names |
| `tests/intents/evaluate.test.js` | Snapshot validation, stale revision, membership, duplicates |
| `tests/intents/reauthorize.test.js` | Re-applying accepted intents to new access: removed projects dropped, revision kept |
| `tests/intents/room-debug.test.js` | Composite room subscriber descriptions |
| `tests/auth/tokens.test.js` | `auth.token` then Bearer; no query-string tokens |
| `tests/auth/session-cache.test.js` | TTL expiry, max-entry eviction, entries bounded by token `exp`, per-user eviction |
| `tests/auth/gaia-session.test.js` | Introspection call with the service token; user, agent, delegated, service and inactive answers; no service token |
| `tests/auth/socket-session-policy.test.js` | User and agent sessions accepted; service, expired and userless refused |
| `tests/socket/auth.test.js` | Handshakes against the stub Gaia introspection: active, inactive, service refused, no service token, expiry disconnect, cache bounded by `exp` |
| `tests/socket/access-recheck.test.js` | `user.access.changed`: membership removal (room left), disabled user (disconnect, cache evicted), unchanged access (no effect), Gaia unreachable (disconnect), other events ignored |
| `tests/config.test.js` | Production secret/CORS requirements, origin option, identity env |
| `tests/auth/service-identity.test.js` | Enrollment (token and user code), restart with stored credential, token refresh, rotation, retries; against an in-process stub Gaia (`tests/support/stub-gaia.js`) |
| `tests/auth/credential-store.test.js` | Atomic mode-600 credential file |
| `tests/auth/retry-scheduler.test.js` | Named timers, retries with Retry-After, stop |
| `tests/auth/identity-factory.test.js` | Identity built only when `HERMES_CREDENTIAL_FILE` is set |

```bash
npm test
```

### Out of scope (this repo)

- Two real browser sessions (A PATCH → B UI)
- Gaia compose / api-tester `--mode live` (covered in Gaia)
- Prometheus Mirage + Fake Hermes (covered in Prometheus)
