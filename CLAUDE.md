# Hermes — Projects4Me realtime relay (Node 18, Express 4, Socket.IO 4)

Read docs/architecture/architecture.md and decisions.md (D-001..D-015) before changing behaviour.

## Run
- Run and test commands: workspace skills `p4m-stack` and `run-tests`.

## Architecture
- Gaia -> `POST /publish` (header `X-Hermes-Secret`, closed envelope in `src/contract/envelope.js`).
- Client -> `intents:set {protocolVersion, revision, intents[]}`; server -> `domain:event`.
- Rooms `v1:intent:<projectId>:<eventName>`; authorization = Gaia project membership (`src/auth/gaia-session.js`), cached (`session-cache.js`).

## Rules
- Hermes stays a locked relay: no domain logic, no storage.
- Event allowlist `src/contract/names.js` must match `gaia/.../EventNames.php`; change both together.
- Contract is closed and versioned: adding a field or event = an ADR entry in decisions.md + tests.
- Production requires `NODE_ENV=production`, `HERMES_SECRET`, `CORS_ORIGIN`.

## House rules

These house rules assume the repo is checked out inside the **Pr4M** workspace (https://github.com/projects4me/Pr4M), which provides `dev-tools/` (the `gaia` MCP server, the shared Agent Odysseus identity, the `ai` workflow CLI, Talos, the `installer`) and the workspace skills and agents in `.claude/`.

### Workflow
- **Issue first.** Before starting any work, find or create its issue in Projects4Me: search with `gaia_list_issues`, create with `gaia_create_issue` (the `gaia` MCP server in `dev-tools/gaia-mcp`), or use the Projects4Me UI. Hermes work goes in project **A Hermes** (short code `ah`). Use its issue number in the branch name (`claude-issue-NNNN`). Move the issue's status as work progresses (`in_progress` → `in_review` → `done`).
- **Milestone, time and notes.** Every issue goes in the project's **Claude-v1** milestone (the `gaia` MCP server does this by default). While working, log the time spent on the issue (`gaia_log_time`, with a short description of what it was spent on) and record the details in its thread (`gaia_add_comment`): what was done, findings, decisions, files changed and what's left. Do both before marking the issue `in_review`.
- **Branch, PR, merge.** Move the issue to `in_progress`, then branch `claude-issue-NNNN` off an up-to-date `dev`. Run the full test suite before opening the PR. Push the branch to the `odysseus` remote and open a PR to `dev` with `odysseus gh pr create`. **Never merge**: the user merges. After the user merges, rebase local `dev` onto `origin/dev` before starting the next issue. Leave uncommitted files you didn't create for this issue alone.
- **Identity: Agent Odysseus.** Commit, push and open PRs only as Agent Odysseus, through `dev-tools/odysseus/odysseus git …` / `odysseus gh …` (see `dev-tools/odysseus/README.md`). Push only to the `odysseus` remote, never to `origin`. Never change git or gh configuration (global or repo) and never use your personal git/GitHub credentials for agent work; if the agent identity isn't available, stop and ask.
- One issue per PR; log anything else you find in the Projects4Me tracker instead of fixing it in the same PR.
- MVP first: items in the Engineering Guide's pre-production table are out of scope unless the issue asks for them.
- Never commit, push, merge, force-push, tag or deploy without explicit approval. Never commit to `master` or `qa`.
- When docs and code disagree, the code wins; flag the doc in your summary.
- Acceptance criteria unclear? Ask instead of guessing, and write down assumptions in the PR.

### Boundaries
- Gaia is the only publisher and the only authority on project membership; never cache or decide access beyond `session-cache.js`.
- Contract changes ship as linked PRs with Gaia (and Prometheus if handlers change), merged together.

### Security
- Never weaken the `X-Hermes-Secret` check, the membership check or the closed envelope validation to make something work.
- Never log tokens, secrets or event payload contents.

### Design (Fowler's layering + SOLID)
- Follow the layering and separation of concerns from Martin Fowler's *Patterns of Enterprise Application Architecture*: transport (HTTP `/publish` and Socket.IO handlers) → domain (contract validation in `src/contract/`, room and intent logic) → gateways (Gaia session lookup in `src/auth/`, cache). Dependencies point down only; handlers don't validate envelopes or call Gaia inline.
- SOLID, especially **Single Responsibility**: one reason to change per module or function. Keep the Gaia client behind one module so its transport can change without touching handlers.
- Before adding a module or function, name its single responsibility; if it needs "and", split it.

### Quality
- "Done" means tests and lint were run and passed. Report failures as they are, and say what wasn't run.
- A bug fix starts with a test that fails.
- No new dependencies and no framework or runtime upgrades without approval.

### PR description
What · Why (issue link) · How tested · Contract impact (events, envelope, Ares format) · Migration impact · Out of scope / follow-ups.
