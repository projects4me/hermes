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
| Decision | `POST /publish` authenticates with `HERMES_SECRET` (`X-Hermes-Secret` or Bearer shared secret). Socket handshakes authenticate the client's OAuth access token with one Gaia introspection call, `POST /api/v1/introspect` (Gaia D-065), made with Hermes's own service token (D-019) and the handshake token in the form field `token`. The socket session is `sub` (user id), `actorType`, `serviceKind`, `projectIds` and `exp` from the answer (`src/auth/gaia-session.js`). User and agent tokens open a socket, delegated agent tokens (`act` set) included; runtime service tokens (`actorType: service`, `serviceKind: runtime`) open a runtimes socket (D-020); every other service token is refused (`src/auth/socket-session-policy.js`). An inactive answer, an answer without an actor type or an `exp`, a token already past its `exp`, a refused service token and an unreachable Gaia are all `unauthorized`. A socket is disconnected (`io server disconnect`) when its token's `exp` passes (`src/socket/expiry.js`, counted in `auth.expired`); the client opens a new socket with its refreshed token. |
| Rationale | Ingest is server-to-server. Socket sessions are user or agent sessions. One credential for both would let a browser publish, or force Gaia to send a user token as a machine secret. One introspection call with Hermes's own token replaces `GET /api/v1/user/me` plus a membership query made with the user's token, gives the actor type, so agents and services can be told apart, and gives the token's expiry, so no socket outlives its token. |
| Implications | Do not send the current user's access token as the publish credential. Do not treat removing query-string socket tokens as a reason to drop the shared-secret header. Without a service token (identity off, or not yet enrolled or approved) every handshake is refused and Gaia is not called: socket auth needs `HERMES_CREDENTIAL_FILE` (D-019), so both local compose services set it. A token revoked before its `exp` keeps an open socket until `exp`, and a new handshake may be served from the cache until the entry expires (D-012); live revocation is out of scope. Runtime service tokens subscribe only to the runtimes scope (D-020). |

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
| Implications | A client that only puts the token in `?token=` is unauthorized. Do not reintroduce query-string auth. The handshake token is the one introspected (D-002) and the socket lives until that token's `exp`: a client that refreshes its token must open a new socket with it, since a running socket's credentials cannot change. |

### D-012 — Gaia session lookups are cached

| | |
|---|---|
| Status | Accepted |
| Decision | Active introspection answers (D-002) are cached by token with `AUTH_CACHE_TTL_MS` (default 5 minutes) and `AUTH_CACHE_MAX_ENTRIES` (default 1000). An entry expires at the TTL or at the token's `exp`, whichever comes first, and a session already past its `exp` is not stored. Inactive answers are not cached. Expired entries are dropped; the oldest entry is evicted when the cache is full. |
| Rationale | Every socket handshake would otherwise hit Gaia introspection. Reconnect storms would amplify that. Bounding entries by `exp` means the cache never accepts a token Gaia would call expired. |
| Implications | Membership changes and revocations can take up to the TTL to affect new sockets. Cache misses still fail closed (`unauthorized`) when Gaia is down, Hermes has no service token, or the token is not active. |

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
| Implications | Do not require `gaia-test` or Ember for `npm test`. Socket auth in tests is a fake `{ userId, actorType, projectIds, expiresAt }`, or the in-process stub Gaia's introspection endpoint (`tests/support/stub-gaia.js`) behind the real loader. Operator detail: `architecture.md` § Testing. |

### D-016 — Idea events are project-scoped allowlist entries

| | |
|---|---|
| Status | Accepted |
| Decision | `EVENT_ALLOWLIST` adds six idea events: `idea.created`, `idea.updated`, `idea.message.created`, `idea.plan.created`, `idea.plan.status.changed`, `idea.planissue.created`. They are project-scoped like the issue events: `projectId` is the idea's project and intents are authorized by project membership. `meta.ideaId` identifies the idea; the envelope is unchanged. |
| Rationale | Gaia publishes idea activity so Prometheus and Talos can react to messages, plans and created issues. Reusing the project scope and the existing `meta` object keeps the closed contract and the membership check as they are. |
| Implications | None of them is in `USER_SCOPED_EVENTS`. Gaia `EventNames` must carry the same six names. Agents have no publish path, and `idea.agent.progress` is not allowlisted. |

### D-017 — `workflow.agent.run.requested` is a user-scoped event

| | |
|---|---|
| Status | Accepted |
| Decision | `EVENT_ALLOWLIST` and `USER_SCOPED_EVENTS` add `workflow.agent.run.requested`. Like `notification.created` (D-009), its `projectId` is `user:<agentUserId>`, so only a socket authenticated as that agent can subscribe. The envelope is unchanged: `resource` is `{ type: 'workflowRun', id: <runId> }` and `meta` carries `workflowId`, `stepId`, `entityType` and `entityId`. |
| Rationale | Gaia asks an agent's runtime to execute a workflow step. Routing it through the user scope delivers it to that agent only, without a new scope field. Carrying ids only keeps prompts and secrets off the relay; the runtime fetches the step from Gaia with its own session. |
| Implications | The event must never carry a prompt, step input or credentials; Hermes does not inspect `meta`, so this is Gaia's publishing rule. Gaia `EventNames` must carry the same name. Project-scoped intents for it are rejected. Gaia also publishes it to the runtimes scope for delegable agents (D-020). |

### D-018 — Timing-safe ingest secret and no default secret outside local dev

| | |
|---|---|
| Status | Accepted |
| Decision | `/publish` compares the shared secret with `crypto.timingSafeEqual` on equal-length buffers; a different length is rejected without comparing. `loadConfig` uses the `hermes-dev-secret` default only when `NODE_ENV` is `development` or `test`. Any other value fails at startup without `HERMES_SECRET`, and also with `HERMES_SECRET=hermes-dev-secret`. The secret is never logged. |
| Rationale | `!==` leaks timing, and the default applied to every non-production environment (staging, typos in `NODE_ENV`). This hardens the shared secret until Hermes has a service identity. |
| Implications | Staging and similar environments must set a real `HERMES_SECRET`. Replacing the shared secret is out of scope. |

### D-019 — Hermes keeps its own Gaia service identity in a credential file

| | |
|---|---|
| Status | Accepted |
| Decision | Hermes gets its own identity from Gaia as a service client of kind `hermes`. When `HERMES_CREDENTIAL_FILE` is set and the file is missing, Hermes enrolls through Gaia's `serviceenrollment` resource (Gaia's "Services enroll themselves" decision): with `GAIA_ENROLLMENT_TOKEN` the request is approved at once (Gaia D-070); without one, Hermes logs the user code once for an admin to approve, then polls until the secret is delivered. It stores `{clientId, clientSecret, serviceClientId, secretIssuedAt}` in that file, written to a new temp file created with mode 600, synced and renamed (mode 600 has no effect on Windows), so restarts need no new enrollment. On every start it gets a client_credentials token, refreshes it at 80% of its lifetime, and rotates its secret once the secret is 7 days old (Gaia D-068, `PATCH /api/v1/serviceclient/{serviceClientId}`), storing the new secret at once, inside Gaia's 10-minute grace for the old one. Gaia calls go through `src/auth/gaia-identity-client.js` (on the HTTP transport `gaia-http.js`, shared with the socket-auth gateway `gaia-session.js`), the file through `credential-store.js`, timers and retries through `retry-scheduler.js`, and `service-identity.js` decides when to call them. Hermes stops its timers on SIGTERM and SIGINT. Without `HERMES_CREDENTIAL_FILE` the identity is off. |
| Rationale | No service secret is copied by hand: it goes from Gaia straight to Hermes. The file is Hermes's own configuration (who it is), not domain storage: it holds no events, users or projects, so Hermes stays a relay (D-001). Keeping the identity opt-in stops every local Hermes from filing enrollment requests before anything uses the token. |
| Implications | Enrollment, token and rotation failures never stop the relay: they are logged (status codes only) and retried in the background after `HERMES_IDENTITY_RETRY_MS`, or after a 429's Retry-After. The enrollment token is single use, so only the first attempt sends it; later attempts fall back to approval by user code. A delivered or rotated secret is kept in memory and its save retried until the file has it, so a failed save never leads to a second enrollment. Polling waits a 429's Retry-After, treats network and 5xx errors as still pending, ends on any other 4xx, and gives up on a request after 16 minutes (Gaia's requests live 15). The poll token travels in the query string because Gaia's contract puts it there; it lives 15 minutes and only polls one request, and Hermes never logs request URLs. The secret, tokens and poll token are never logged; the user code appears once. A credential that Gaia refuses (client disabled, secret lost after the grace period) keeps being retried; the operator deletes the file to enroll again. A credential stored without `serviceClientId` still gets tokens but is not rotated. Gaia returns `serviceClientId` on the delivering poll since agaia-4408. Socket auth introspects handshake tokens with this token (D-002, ah-4396), so with the identity off every socket handshake is refused. |

### D-020 — Runtime service tokens take `workflow.agent.run.requested` on the `runtimes` scope

| | |
|---|---|
| Status | Accepted |
| Decision | `RUNTIMES_SCOPE` is `runtimes` and `RUNTIME_SCOPED_EVENTS` is `{ workflow.agent.run.requested }` (`src/contract/names.js`). Like D-009 and D-017 the scope rides in `projectId`: `/publish` accepts `projectId: 'runtimes'` for the runtime-scoped events only and rejects it (400 `invalid_event`, `/projectId`) for every other event. A socket whose introspection answer is `actorType: service` with `serviceKind: runtime` may open a socket (`isRuntimeSession` in `src/auth/socket-session-policy.js`); it has no user id. Such a socket may set only `{ projectId: 'runtimes', eventName: <runtime-scoped event> }`; every other intent (project, user scope, or another event on `runtimes`) is rejected as `project_not_authorized`. User and agent sockets, delegated agent tokens with `serviceKind: runtime` included, are rejected on the `runtimes` scope. Service tokens of any other kind still cannot open a socket. |
| Rationale | Talos runtimes take run requests for every delegable agent on one socket instead of one socket per agent. Reusing `projectId` as the scope keeps the closed envelope and the composite rooms unchanged (D-009). Keying on the introspected `actorType` and `serviceKind` keeps Gaia the authority on who is a runtime, and allowing a runtime nothing else keeps a service token off project and user data. |
| Implications | Gaia publishes the same envelope twice for a delegable agent: to `user:<agentUserId>` (D-017) and to `runtimes` (agaia-4394); the contract changes merge together. Every runtime socket receives every runtime request: which runtime takes a step is Gaia's claim, not Hermes routing (per-runtime routing is out of scope). The event still carries ids only (D-017). Prometheus never uses this scope. |

---

### D-021 — `user.access.changed` re-checks that user's sockets

| | |
|---|---|
| Status | Accepted |
| Decision | `EVENT_ALLOWLIST` and `USER_SCOPED_EVENTS` add `user.access.changed` (Gaia live-updates D-011, agaia-4393). Gaia publishes it with `projectId` `user:<userId>`, `resource` `{ type: 'user', id: <userId> }` and empty `changes` after an account status change (after the session revocation), and after a membership is created or deleted. `POST /publish` emits it like any user-scoped event (D-009), then starts a re-check without holding Gaia's request (`src/socket/access-recheck.js`): Hermes evicts the user's cached sessions and introspects each of the user's sockets again with the token from its handshake, queued behind that socket's `intents:set` work. A socket whose token is not accepted any more (D-002 policy), whose introspected user differs, or whose re-check fails (Gaia unreachable) is disconnected (`io server disconnect`). Any other socket gets the new project ids and its accepted intents are re-applied (`src/intents/reauthorize.js`): it leaves the rooms of projects it is no longer a member of, and its revision is kept. The fresh session is cached. |
| Rationale | Hermes checks access at connect and caches it (D-012), so removed members and disabled users kept receiving events. Gaia owns access, so it only says *whose* access changed and Hermes asks Gaia for the new access instead of trusting a payload. The issue asked for the event not to reach clients; it is delivered to the user's own sockets anyway, because Gaia's merged `hermes.expect` live cases (agaia-4393) subscribe to it to observe the publish, and the payload carries only the user's own id, so a client may use it to refresh what it shows. Disconnecting on a failed re-check fails closed: the client reconnects and its handshake asks Gaia. |
| Implications | Gaia `EventNames` carries the same name. Project-scoped intents for it are rejected. Role changes are out of scope (they don't change what Hermes routes). A missed event (Hermes down, fail-open publish) leaves cached access until the cache TTL or token expiry. Membership additions are picked up for later `intents:set` snapshots; Hermes does not join rooms the client did not ask for. `/health` reports the `access` counters (`events`, `socketsRechecked`, `socketsDisconnected`, `intentsDropped`, `failures`). |

### D-022 — `doc.created`, `doc.updated` and `doc.deleted` join the allowlist

| | |
|---|---|
| Status | Accepted |
| Decision | `EVENT_ALLOWLIST` adds `doc.created`, `doc.updated` and `doc.deleted` (ah-4530, Gaia idea "Docs"), in the same order as Gaia `EventNames`. They are project-scoped like the issue and idea events: `projectId` is a project id, `resource` is `{ type: 'doc', id: <docId> }`, and `doc.updated` carries the changed field names in `changes` (ids and names only, no values). `POST /publish` emits them to the rooms of members whose `intents:set` names them. Any other `doc.*` name is still rejected as an unknown event (400). |
| Rationale | Docs lists and open doc pages update live on create, rename, lock and delete. Gaia owns the domain and publishes; Hermes only accepts the names (D-003). The envelope is unchanged, so no field is added. |
| Implications | Gaia `EventNames` carries the same names; the contract changes merge together. Doc content traffic is out of scope: it goes through the collab server, never through Hermes. |

---

## Open questions

- Replace `projectId: "user:…"` with a real `scope` field (requires Gaia + Prometheus).
- Sharing the allowlist as a package instead of lockstep PHP / JS copies.
