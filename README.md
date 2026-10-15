# RemoNet

RemoNet is a network operations dashboard starter for monitoring infrastructure across networks, areas, and organizations. It includes individual engineer accounts, organization and team administration, memberships and invitations, protected API routes, an audit trail, organization-scoped inventory management, a monitoring data model with timestamped observation history, and a collector framework whose first collector is a simulator, so the whole collection path runs without hardware and dashboards update live. See the [development roadmap](docs/DEVELOPMENT_ROADMAP.md) for the planned milestones.

## Runtime requirements

- Node.js 24 or newer (the repository pins the major in `.nvmrc`)
- npm 11 or newer

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev:api
```

In a second terminal, run:

```powershell
npm run dev
```

Open `http://127.0.0.1:5173` or `http://localhost:5173`. Vite proxies `/api` to the API on `127.0.0.1:3001`. Development allows these loopback aliases; configure the exact HTTPS origin(s) for production.

Local development accounts:

- **Solo:** `solo@remonet.local` / `SoloNetwork2026!`
- **Multi-organization:** `engineer@remonet.local` / `EngineerNetwork2026!`

Demo data and accounts are seeded only when `NODE_ENV=development` and `REMONET_SEED_DEMO` is not `false`. Never deploy the known demo credentials. The SQLite file defaults to `data/remonet.sqlite` and is excluded from Git. `REMONET_DB_PATH` can override the path.

## Project commands

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
```

For local development, keep `npm run dev:api` and `npm run dev` running in separate terminals. You do not need to run `npm run build`; `dist/` is only created by a production build and can be removed when you want to clean generated output. TypeScript incremental metadata is stored under ignored `node_modules/.cache/` rather than the project root. `npm run start:api` runs the compiled API and expects a prior build.

## Architecture

The repository is one deployable application, split by runtime and responsibility instead of adding workspace/package overhead:

- `src/` contains the React/Vite client, screen components, and UI-only network metrics.
- `server/modules/` groups HTTP routes, controllers, and use-case services by feature.
- `server/http/` holds request authentication, access guards, and standardized error handling.
- `server/persistence/` owns the SQLite connection, SQL migrations, fixtures, query scoping, and repositories.
- `server/collectors/` holds the protocol-independent collection boundary: the `Collector` interface, its result and target types, and the translation from a collector's answer into an observation. Collectors never touch the database.
- `shared/` contains data contracts used by both client and API; it does not depend on either runtime.
- `tests/` contains the Vitest suite, grouped by runtime (`tests/server/` today; a `client` project can be added alongside it).

The request flow is **route → controller → service → repository**. Controllers translate HTTP requests and responses; services enforce use-case rules; repositories own SQL. The schema is written in SQL and data access is explicit, so there is no ORM to obscure queries or add a large dependency tree.

## Database and migrations

The API opens SQLite through `better-sqlite3`, enables foreign keys, WAL journaling, a busy timeout, and normal synchronous mode. `server/persistence/migrations/` contains ordered, immutable SQL migrations. On startup the migration runner applies each migration in a transaction and stores its SHA-256 checksum. Editing an applied migration is rejected; add the next numbered migration instead.

The initial migration uses strict tables and relational constraints for organizations, networks, areas, devices, users, teams, memberships, invitations, and sessions. Existing local databases are preserved: the initial migration uses `CREATE TABLE IF NOT EXISTS`, then local fixture seeding fills any missing demo records.

Migration `010` adds `monitoring_enabled` and `poll_interval_seconds` to `networks` so collection can be paused or slowed per network; existing networks keep collecting every 60 seconds.

Migration `009` adds `device_observations`: one row per timestamped check of a device (source, result, latency, load, uptime, error details). Rows are append-only (a trigger rejects `UPDATE`), follow their device on deletion, and are pruned per device to `REMONET_OBSERVATION_RETENTION` rows (default 200). Inventory and monitoring history therefore live in separate tables. `server/modules/monitoring/monitoring.service.ts` is the only writer: `recordObservation` stores a check, refreshes the device's cached snapshot (`status`, `uptime`, `latency`, `load`, `lastSeen`) from the newest observation, and prunes the history, all in one transaction. `shared/device-status.ts` is the single definition of the statuses, used when an observation is recorded and again on every read:

- **Pending** — enrolled but never observed, or re-addressed and awaiting a fresh check.
- **Healthy** — the newest check succeeded within the staleness window and latency is at most 25 ms and load at most 70%.
- **Warning** — the newest check succeeded within the window but latency or load exceed those thresholds.
- **Offline** — the newest check timed out or failed, or the device has not answered within `REMONET_STALE_AFTER_SECONDS` (default 300). A stale device keeps its last measurements and `lastSeen`, but its status is reported as `Offline` without waiting for a collector to write anything.

Every device the API returns carries a one-line `statusReason` derived at the same time (`answered in 4 ms at 32% load`, `load 82% is above the 70% limit`, `The last check got no answer`, `No successful check for 12 min (limit 5 min)`, `Waiting for the first check`), and each recorded check in a device's history reads as the status it established (`Healthy`, `Warning`, `Timed out`, `Error`) with the same explanation, so a Warning is never a mystery.

Collectors implement the `Collector` interface in `server/collectors/collector.ts`: `check(target, signal)` answers with a `CollectorResult` (`success` with `latencyMs` and optional `loadPercent`/`uptimeSeconds`, `timeout`, or `error` with a message) and must settle promptly once the `AbortSignal` aborts; a rejection with an `AbortError` is treated as a timeout, any other rejection as an error. `observationFrom` turns that answer into the input of `recordObservation`.

`server/collectors/simulator.ts` is the first collector: it answers for hardware that does not exist. Each device gets a stable personality derived from its id and address (70% steady, 10% busy, 10% slow, 7% flaky, 3% down), checks are numbered per device and every measurement is derived from that number, so the same inventory tells the same story on every run; personalities can be pinned per device and a seed changes the whole story. Busy and slow devices cross exactly one warning threshold, down devices alternate timeouts and `EHOSTUNREACH` errors, flaky devices fail about a third of the time, uptime grows with the clock and resets after an outage, and the simulated round trip honours cancellation.

`server/collectors/scheduler.ts` runs collectors. Every network with monitoring enabled gets its own cycle, repeated `pollIntervalSeconds` after the previous cycle completes (cycles of one network never overlap); the scheduler re-reads network settings before each cycle and discovers new or re-enabled networks every 30 seconds, so changes made through `PATCH /api/networks/:networkId` take effect without a restart. Within a cycle each device is checked with a timeout (`REMONET_CHECK_TIMEOUT_MS`, default 3000), at most `REMONET_MAX_CONCURRENT_CHECKS` (default 8) checks run at once across all networks, and failures are retried with exponential backoff up to `REMONET_CHECK_ATTEMPTS` (default 3) before the outcome is recorded. Stopping the scheduler cancels in-flight checks without recording anything for them. Each check and each cycle produce a structured log line through the API's logger (`Device checked` carries the device, address, source, trigger, result, attempts, latency or error, and collection time; `Collection cycle completed` carries the counts and duration), and `getState()` exposes per-network collection state (enabled, running, next run, last cycle summary, last error).

`server/collectors/runtime.ts` wires the scheduler into the API process according to `REMONET_COLLECTOR` (`simulator` by default in development, `off` elsewhere unless set): it starts when the server is ready, is the first thing stopped on shutdown, and is reachable by use cases. Enrolling a device or changing its management address asks the collector for an immediate check, so a new device leaves `Pending` within its first round trip instead of waiting for the network's next cycle; engineers can also ask for a check from the device management panel, which then follows the request through to the recorded result. Observations, inventory changes, and completed cycles are published in-process and streamed to dashboards as server-sent events; the dashboard refreshes as they arrive (bursts are coalesced), shows the stream state in its footer, and administrators see per-network collection state on the Settings page.

The demo fixtures stamp their illustrative `lastSeen` values relative to startup so a fresh development database does not begin stale; until a collector keeps them current, they will age into `Offline` after the window. Development seeding also inserts a short observation history per demo device so the history view has timestamped checks from the first start, and, like the demo passwords, restamps the demo devices' telemetry on every local start (metadata edits are kept).

Every health figure the dashboard shows is computed from this model: `/api/overview` counts the statuses derived at read time and reports `updatedAt` as the newest collection time in scope (observations first, then cached `lastSeen`; `null` when nothing has ever reported) rather than the time of the request. The overview panel shows "Data last updated …", and the device management panel shows when each device last answered and can expand its recent check history.

Migration `006` adds the `audit_log` table. It is append-only (triggers reject `UPDATE` and `DELETE`), stores the actor as a snapshot so history survives account changes, and references `organizations` without cascading, so an organization with history cannot be removed without an explicit migration.

For production bootstrap, set `NODE_ENV=production`, HTTPS `REMONET_ALLOWED_ORIGIN` and `REMONET_APP_ORIGIN`, and on an empty database provide `REMONET_BOOTSTRAP_EMAIL` and `REMONET_BOOTSTRAP_PASSWORD` (minimum 12 characters). RemoNet creates the first organization, owner team, and account. Remove bootstrap credentials after the first successful startup. Use a separate production database path; startup refuses a database containing demo organizations. Serve the UI and API under the same origin through a trusted VPN or HTTPS reverse proxy, and set `API_HOST` and the origins accordingly. Do not expose the API directly to the public internet.

## Authentication and API

Each engineer gets a personal account. Team membership grants organization access, and one account may belong to teams across several organizations; a person is never duplicated, their memberships are. An engineer's role in an organization is the highest role across their teams there. Owners and admins can create seven-day invitation links; invitees register with an individual account or sign in to join with an existing account. People who already belong to the organization are added to further teams directly, without an invitation.

## Permission matrix

`shared/permissions.ts` is the single source of truth: the API enforces it in services and the UI reads it to show or hide controls. Tests pin the table below.

| Capability                                                        | Owner | Admin | Operator | Viewer |
| ----------------------------------------------------------------- | :---: | :---: | :------: | :----: |
| Read inventory, overview, teams, and the member roster            |   ✓   |   ✓   |    ✓     |   ✓    |
| Enroll devices, edit device metadata, move devices between areas  |   ✓   |   ✓   |    ✓     |        |
| Create, rename, delete networks and areas; remove devices         |   ✓   |   ✓   |          |        |
| Read the audit trail                                              |   ✓   |   ✓   |          |        |
| Create and rename teams                                           |   ✓   |   ✓   |          |        |
| Invite, add to teams, change roles, remove: operators and viewers |   ✓   |   ✓   |          |        |
| Invite or grant admin; manage admins and owners; grant ownership  |   ✓   |       |          |        |
| Rename the organization; delete empty teams                       |   ✓   |       |          |        |

Two actions are not tied to a role: any signed-in engineer may create a new organization (becoming its owner through its first team), and any member may leave a team.

Safeguards that apply regardless of role: an organization always keeps at least one active owner (the last owner cannot be demoted or removed, including by themselves); admins cannot act on anyone whose effective organization role is admin or owner, even through a team where that person holds a lower role; ownership is never granted through an invitation link, only by an owner after the person has joined; a team with members cannot be deleted; an invitation for someone who is already in the target team is refused. The read-only integration token can read inventory and teams only.

Browser sessions use server-side session records and an `HttpOnly`, `SameSite=Strict` cookie, marked `Secure` in production. Passwords use Node's scrypt implementation. The API applies request schemas, a small body limit, rate limiting, security headers, exact-origin checks, and generic server errors with request IDs. Integration bearer credentials are optional server-only secrets; they must be at least 32 characters and can be limited with `REMONET_API_ORGANIZATION_IDS`. No public-key authentication is used.

Endpoints:

- `GET /api/health` and `GET /api/ready` — liveness and database readiness
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `POST /api/invitations`, `/api/invitations/inspect`, `/api/invitations/accept`
- `GET /api/invitations?organizationId=` and `DELETE /api/invitations/:invitationId?organizationId=` — owner/admin; list and revoke pending invitation links
- `GET /api/organizations`, `/api/teams`, `/api/networks`, `/api/areas`, `/api/devices`, `/api/overview`
- `POST /api/organizations` — any engineer; creates the organization, its first team (`teamName`, default `Owners`), and the caller's owner membership
- `PATCH /api/organizations/:organizationId` — owner only; rename
- `GET /api/organizations/:organizationId/members` — members only; the roster with each person's team memberships and effective role
- `POST /api/teams`, `PATCH /api/teams/:teamId` — owner/admin; `DELETE /api/teams/:teamId?organizationId=` — owner only, empty teams only
- `POST /api/teams/:teamId/members` — owner/admin; adds an existing organization member to the team with a role the caller may grant
- `PATCH /api/teams/:teamId/members/:userId` — owner/admin; changes the role held in that team
- `DELETE /api/teams/:teamId/members/:userId?organizationId=` — owner/admin within their authority, or the member themselves (leave)
- `POST /api/networks` and `PATCH /api/networks/:networkId` — owner/admin only, scoped to an organization the engineer belongs to; network names are unique within that organization. Optional `monitoringEnabled` (default `true`) and `pollIntervalSeconds` (5–3600, default 60) control collection for the network; a `PATCH` without them leaves the settings unchanged
- `POST /api/areas` and `PATCH /api/areas/:areaId` — owner/admin only, scoped to a network in an organization the engineer belongs to; area names are unique within their network
- `DELETE /api/areas/:areaId` — owner/admin only; areas with devices cannot be deleted
- `POST /api/devices` — owner/admin/operator only, requires an area in the selected network; a management address can only appear once per network
- `PATCH /api/devices/:deviceId` — owner/admin/operator only; edits metadata or moves a device to another area in the same network
- `DELETE /api/devices/:deviceId` — owner/admin only
- `GET /api/devices/:deviceId/observations?organizationId=&limit=` — any member (and the integration token); the device's recorded checks, newest first (`limit` default 50, maximum 200)
- `POST /api/devices/:deviceId/check` — owner/admin/operator; asks the running collector to check the device now (`202`), or `409` when no collector runs
- `GET /api/monitoring/status?organizationId=` — owner/admin; the collector in use and per-network collection state (enabled, interval, running, next run, last cycle, last error) for the organizations the engineer administers
- `GET /api/monitoring/events?organizationId=` — any member (and the integration token); a server-sent event stream of `observation`, `inventory`, and `cycle` events for the engineer's organizations, with a heartbeat every 15 seconds
- `GET /api/audit` — owner/admin only; lists the audit trail for organizations the engineer administers, newest first. Accepts `organizationId`, `entityType`, `entityId`, and `limit` (default 100, maximum 500)

Network data endpoints accept `organizationId`, `networkId`, and `areaId` filters. The server intersects those filters with the authenticated principal's organization memberships.

## Audit trail

Security-sensitive changes are recorded in `audit_log` in the same transaction as the change itself, so an event exists exactly when the change was committed. Each event stores the organization, the acting account (id and email), the action, the entity, and a JSON `details` snapshot (`after` for creations, `before`/`after` for updates, `before` for deletions). Recorded actions: `organization.created`, `organization.updated`, `team.created`, `team.updated`, `team.deleted`, `network.created`, `network.updated`, `area.created`, `area.updated`, `area.deleted`, `device.enrolled`, `device.updated`, `device.deleted`, `membership.invited`, `membership.accepted`, `membership.invitation_revoked`, `membership.added`, `membership.role_changed`, and `membership.removed`. Membership events use the affected account id as the entity id (invitation events use the invitation id). Refused or failed requests are not recorded.

## Organization switching in the UI

The sidebar workspace switcher lists every organization the signed-in account belongs to with the role held in each; the selection is remembered per account. The top bar always names the current organization and role, and the heading badge reflects what that role can do. The **Organization** page shows ownership context (owners, member and team counts), the member roster with per-team roles, team administration, pending invitations, and the invitation form. With no organization selected, or from the switcher's "New organization" entry, it lists every organization of the account and lets any engineer start a new one with the same account.

## Tests

`npm test` runs the whole Vitest suite; `npm run test:watch` keeps it running, `npm run test:server` / `npm run test:client` run one project, and `npm run test:coverage` adds a V8 coverage report (text summary plus `coverage/index.html`). Vitest is configured with two projects in `vitest.config.ts`:

- `server` boots the real Fastify application in-process with `app.inject()` against a private SQLite file per test file (`tests/server/setup/environment.ts` sets `NODE_ENV=test` and the database path before any server module loads).
  - `tests/server/api/` — login and session lifecycle, tenant isolation, role permissions (including engineers in several teams of one organization and in several organizations), request validation, CRUD scope boundaries, organizations, teams, memberships, invitations, the audit trail, device status derivation and staleness as reported by the API, device observation history and overview freshness, collection state and on-demand checks (including the immediate check after enrollment or re-addressing), the server-sent event stream over a real socket, the application booted with the simulator configured, and HTTP hardening (origin checks, rate limiting, body limits).
  - `tests/server/persistence/` — migration runner guarantees, uniqueness constraints, foreign-key relationships, deletion safeguards, the observation history repository (ordering, scoping, retention pruning), and the development/production seeding rules.
  - `tests/server/integration/` — the whole collection path without hardware: the real API enrolls a device, the scheduler drives the simulator against the real inventory, and the API reports the new statuses, histories, freshness, and collection state.
  - `tests/server/unit/` — the permission matrix, configuration validation, authorization and route guards, service-level guards that do not depend on the HTTP layer, the device status rules, the observation recording service, the collector contract, the collector scheduler (timeouts, concurrency, retry/backoff, per-network controls, shutdown, with fake timers and a scripted collector), the simulator's determinism and personalities, password hashing, the scope-to-SQL builder, and authentication primitives.
- `client` renders React components in jsdom with Testing Library and the `api` module mocked (`tests/client/helpers/api-mock.ts`). The project uses Vitest's `vmThreads` pool so each worker creates one jsdom window and runs every test file in its own VM context; files stay isolated without rebuilding the environment per file.
  - `tests/client/App.test.tsx` — session bootstrap, sign-in and sign-out, 401 handling, and every invitation-link route (new person, existing account signed out or signed in, invalid link).
  - `tests/client/components/` — the auth screens, role-gated controls on every management panel (networks including their collection settings, areas, device enrollment and management with check history and on-demand checks, teams, members, invitations), the collection state panel, the Organization page, the workspace switcher, organization switching and data scoping in the dashboard, live updates over a scripted event stream, the dashboard pages, and the device table.
  - `tests/client/api/` and `tests/client/lib/` — the `fetch` wrapper (credentials, headers, `ApiError` mapping) and the endpoint-to-route contract for every API call, plus the overview and area metrics, relative time formatting, and the event-stream subscription with burst coalescing.

`tests/server/helpers/fixtures.ts` seeds the demo inventory from `server/persistence/demo-fixtures.ts` plus test-only accounts that cover every role. Each server test runs inside a transaction that is rolled back afterwards, so tests never depend on each other's writes. Tests are type-checked by `npm run typecheck` through `tsconfig.test.json` and `tsconfig.test.client.json`, and linted with the rest of the code.

## Current limits

The only collector is the simulator; it stands in for hardware, so statuses in development tell a plausible but fictional story. Outside development `REMONET_COLLECTOR` defaults to `off`, in which case devices age into `Offline` once their last successful check passes the staleness window. Device enrollment creates a `Pending` inventory record until the first check lands; changing its management address resets it to `Pending`. Protocol collectors (ICMP, SNMP), topology discovery, email delivery, SSO, password recovery, account deactivation through the API, and organization deletion are not implemented; an organization with audit history cannot be deleted at the database level either. The server currently supports one SQLite process and is intended for a trusted single deployment, not horizontally scaled instances. Extend the test suite alongside any new write operation or change to the authorization model.
