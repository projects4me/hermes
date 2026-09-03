# Hermes decisions

Agreed relay decisions for Hermes. Gaia publishing and Prometheus handlers
are out of scope here.

| Field | Value |
|-------|-------|
| Status | Accepted |
| Scope | Hermes ingest, socket auth, intents, and rooms |
| Primary code | `src/http/`, `src/socket/`, `src/intents/`, `src/contract/`, `src/auth/` |

---

## How to use this file

- Add a new decision whenever relay behavior is agreed or changed.
- Record Hermes-owned choices only (what to accept, how to authenticate,
  how to join rooms). Publish *when* and screen *who applies* belong in
  Gaia / Prometheus.
- Mark open questions separately so they are not treated as settled policy.

---

## Architecture decisions

### D-001 — Hermes is a locked relay

| | |
|---|---|
| Status | Accepted |
| Decision | Hermes validates envelopes, authenticates sockets, maps intents to rooms, and emits `domain:event`. It does not know issues, boards, or comments, and it does not persist events. |
| Rationale | Persist and authorization stay in Gaia. UI application stays in Prometheus. The relay must stay replaceable without carrying domain knowledge. |
| Implications | Controllers in Gaia never emit Socket.IO events. Prometheus never names Hermes rooms. Do not add an event store or domain model layer here. |

### D-002 — Two authentication doors

| | |
|---|---|
| Status | Accepted |
| Decision | `POST /publish` authenticates with `HERMES_SECRET` (`X-Hermes-Secret` or Bearer shared secret). Socket handshakes authenticate with the user's OAuth access token against Gaia `GET /api/v1/user/me`. |
| Rationale | Ingest is server-to-server. Socket sessions are user sessions. One credential for both would let a browser publish, or force Gaia to send a user token as a machine secret. |
| Implications | Do not send the current user's access token as the publish credential. Do not treat removing query-string socket tokens as a reason to drop the shared-secret header. |

### D-003 — Event names are an allowlist

| | |
|---|---|
| Status | Accepted |
| Decision | Publishable names live in `EVENT_ALLOWLIST` (`src/contract/names.js`). Both `POST /publish` and `intents:set` refuse anything outside that list. |
| Rationale | Unknown names must not create rooms or reach browsers. The list documents the contract in this repo and must stay in lockstep with Gaia `EventNames`. |
| Implications | Adding a live event requires this allowlist plus the matching Gaia `EventNames` entry. A name Prometheus registers but Hermes does not allow is rejected here. |

### D-004 — Room keys are internal composite rooms

| | |
|---|---|
| Status | Accepted |
| Decision | Fan-out uses `v1:intent:<encodedProjectId>:<eventName>`. Clients send `{ projectId, eventName }` only. Gaia never names Socket.IO rooms. |
| Rationale | Room strings are a routing implementation. Exposing them would couple Gaia and Prometheus to Socket.IO topology and make user-scoped `user:<id>` keys a public contract. |
| Implications | Do not accept a `rooms` array on ingest. Do not return room keys as something clients should join by name. `POST /publish` may echo the room in its JSON for operators only. |

### D-005 — Intents are a full snapshot with a rising revision

| | |
|---|---|
| Status | Accepted |
| Decision | Every `intents:set` replaces the socket's rooms from the submitted set. `revision` must be a nonnegative integer greater than the last accepted revision on that socket. A new connection starts at revision `-1` with no rooms. |
| Rationale | Deltas would desync on dropped acks. Reconnect creates a new socket, so the previous snapshot is gone. A rising revision lets the client ignore stale acks. |
| Implications | The client must resend its current set after reconnect. An empty accepted set leaves the socket in no intent rooms. Stale revisions are rejected with `stale_revision` and do not change rooms. |

### D-006 — Intent state is per Socket.IO connection

| | |
|---|---|
| Status | Accepted |
| Decision | Rooms and revision belong to the socket, not the user. Closing a tab (or any disconnect) removes that socket from every composite room. |
| Rationale | Two tabs for one user can register different screens. Sharing rooms by userId would leak one tab's subscriptions onto another. |
| Implications | Do not restore intents from a user-level cache on reconnect. Two sockets for the same user receive only the events each registered. |

### D-007 — Validate fully, then join before leave, serialized per socket

| | |
|---|---|
| Status | Accepted |
| Decision | `evaluateIntentSet` does not change rooms. After a snapshot is accepted, `replaceIntentRooms` joins new rooms then leaves obsolete ones. `intents:set` handlers run on `socket.data.intentQueue` so two rapid revisions cannot both validate against the same prior state. |
| Rationale | Applying a partially validated set, or leaving before joining, would drop events. Concurrent snapshots finishing out of order would leave the socket on the wrong rooms. |
| Implications | Room replacement is the only mutation after a successful evaluate. A `room_update_failed` ack means the previous rooms still stand. |

### D-008 — Apply the authorized unique subset

| | |
|---|---|
| Status | Accepted |
| Decision | A valid, non-stale snapshot is applied for every intent that is authorized and not a duplicate. Unauthorized intents are `project_not_authorized`. Duplicate `(projectId, eventName)` pairs are `duplicate_intent`. Both go in `rejected`; the rest go in `accepted` and become the new rooms. |
| Rationale | One bad intent in a screen's snapshot must not wipe the socket's other subscriptions. Deduping keeps a composite room joined once. |
| Implications | An ack can contain both `accepted` and `rejected`. If every intent is rejected, the socket's rooms become empty. |

### D-009 — User-scoped events reuse `projectId` as `user:<userId>`

| | |
|---|---|
| Status | Accepted |
| Decision | `notification.created` requires `projectId === 'user:' + socketUserId`. There is no separate `scope` field. Other events require `projectId` in the socket's Gaia memberships. |
| Rationale | Composite rooms already key on `(projectId, eventName)`. Reusing the field routes only to that recipient without a contract change. |
| Implications | A socket cannot subscribe to another user's notification room. Replacing this with a dedicated `scope` field is a cross-repo contract change, not a Hermes-only fix. |

### D-010 — Closed contract: extra fields rejected, version 1, at most 100 intents

| | |
|---|---|
| Status | Accepted |
| Decision | Envelopes and `intents:set` bodies reject unknown keys. `schemaVersion` / `protocolVersion` must be `1`. An `intents` array may have at most 100 items. |
| Rationale | Extra fields would let callers smuggle routing or payload the other side does not understand. A cap bounds room churn per snapshot. |
| Implications | Adding a field is a versioned contract change. Hermes does not silently ignore unknown envelope keys. |

### D-011 — Socket token from `auth.token`, then Bearer header

| | |
|---|---|
| Status | Accepted |
| Decision | Handshake credentials come from Socket.IO `auth.token`, then `Authorization: Bearer`. Query-string tokens are not accepted. |
| Rationale | Tokens in the URL leak to logs, proxies, and Referer. Prometheus already sends `auth.token`. |
| Implications | A client that only puts the token in `?token=` is unauthorized. Do not reintroduce query-string auth. |

### D-012 — Gaia session lookups are cached

| | |
|---|---|
| Status | Accepted |
| Decision | Successful Gaia session loads are cached by token with `AUTH_CACHE_TTL_MS` (default 5 minutes) and `AUTH_CACHE_MAX_ENTRIES` (default 1000). Expired entries are dropped; the oldest entry is evicted when the cache is full. |
| Rationale | Every socket handshake would otherwise hit Gaia `GET /api/v1/user/me` (and memberships). Reconnect storms would amplify that. |
| Implications | Membership changes can take up to the TTL to affect new sockets. Cache misses still fail closed (`unauthorized`) when Gaia is down or the token is invalid. |

### D-013 — Ingest is fail-closed; valid envelopes emit even with zero subscribers

| | |
|---|---|
| Status | Accepted |
| Decision | Bad secret → 401. Invalid envelope → 400. A valid envelope is emitted on the matching room and returns 200 even when that room has zero subscribers (logged and counted as `zeroSubscribers`). |
| Rationale | Hermes must not accept garbage. Zero listeners is a normal case (no matching screen open), not a publish failure. REST fail-open on Hermes HTTP errors is Gaia's decision, not this server's. |
| Implications | Do not 404 or 5xx a valid publish because nobody is listening. Do not swallow invalid envelopes as 200. |

### D-014 — Two compose services so live tests do not retarget daily-dev

| | |
|---|---|
| Status | Accepted |
| Decision | `hermes` listens on `:9000` and authenticates against OG Gaia `:8080`. `hermes-test` listens on `:9001` and authenticates against `gaia-test` `:8081`. |
| Rationale | Api-tester live mode must not retarget the main Hermes `GAIA_URL`. Mixing test tokens with the daily-dev relay would join test sockets to production-dev rooms. |
| Implications | Gaia-test publishes to `:9001`. Prometheus / daily Gaia use `:9000`. Do not point the main Hermes `GAIA_URL` at `gaia-test` for live coverage. |

### D-015 — Tests are in-process Node tests with a stub Gaia loader

| | |
|---|---|
| Status | Accepted |
| Decision | Hermes tests run with `node --test` against `createHermesApp` and a stub `loadSession`. They do not start Gaia, Prometheus, or Docker compose. |
| Rationale | Gaia already covers publish rules and real REST→Hermes wiring via PHPUnit and api-tester `--mode live`. Prometheus covers screen consumption with Mirage + Fake Hermes. Duplicating those stacks here would couple this repo's CI to siblings. |
| Implications | Do not require `gaia-test` or Ember for `npm test`. Socket auth in tests is a fake `{ userId, projectIds }`. Operator detail: `architecture.md` § Testing. |

---

## Open questions

- Replace `projectId: "user:…"` with a real `scope` field (requires Gaia + Prometheus).
- Sharing the allowlist as a package instead of lockstep PHP / JS copies.
