# RemoNet

RemoNet is a network operations dashboard starter for monitoring infrastructure across networks, areas, and organizations. It includes individual engineer accounts, organization and team administration, memberships and invitations, protected API routes, an audit trail, and organization-scoped inventory management. Live device monitoring is not implemented yet. See the [development roadmap](docs/DEVELOPMENT_ROADMAP.md) for the planned milestones.

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
- `shared/` contains data contracts used by both client and API; it does not depend on either runtime.
- `tests/` contains the Vitest suite, grouped by runtime (`tests/server/` today; a `client` project can be added alongside it).

The request flow is **route → controller → service → repository**. Controllers translate HTTP requests and responses; services enforce use-case rules; repositories own SQL. The schema is written in SQL and data access is explicit, so there is no ORM to obscure queries or add a large dependency tree.

## Database and migrations

The API opens SQLite through `better-sqlite3`, enables foreign keys, WAL journaling, a busy timeout, and normal synchronous mode. `server/persistence/migrations/` contains ordered, immutable SQL migrations. On startup the migration runner applies each migration in a transaction and stores its SHA-256 checksum. Editing an applied migration is rejected; add the next numbered migration instead.

The initial migration uses strict tables and relational constraints for organizations, networks, areas, devices, users, teams, memberships, invitations, and sessions. Existing local databases are preserved: the initial migration uses `CREATE TABLE IF NOT EXISTS`, then local fixture seeding fills any missing demo records.

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
- `POST /api/networks` and `PATCH /api/networks/:networkId` — owner/admin only, scoped to an organization the engineer belongs to; network names are unique within that organization
- `POST /api/areas` and `PATCH /api/areas/:areaId` — owner/admin only, scoped to a network in an organization the engineer belongs to; area names are unique within their network
- `DELETE /api/areas/:areaId` — owner/admin only; areas with devices cannot be deleted
- `POST /api/devices` — owner/admin/operator only, requires an area in the selected network; a management address can only appear once per network
- `PATCH /api/devices/:deviceId` — owner/admin/operator only; edits metadata or moves a device to another area in the same network
- `DELETE /api/devices/:deviceId` — owner/admin only
- `GET /api/audit` — owner/admin only; lists the audit trail for organizations the engineer administers, newest first. Accepts `organizationId`, `entityType`, `entityId`, and `limit` (default 100, maximum 500)

Network data endpoints accept `organizationId`, `networkId`, and `areaId` filters. The server intersects those filters with the authenticated principal's organization memberships.

## Audit trail

Security-sensitive changes are recorded in `audit_log` in the same transaction as the change itself, so an event exists exactly when the change was committed. Each event stores the organization, the acting account (id and email), the action, the entity, and a JSON `details` snapshot (`after` for creations, `before`/`after` for updates, `before` for deletions). Recorded actions: `organization.created`, `organization.updated`, `team.created`, `team.updated`, `team.deleted`, `network.created`, `network.updated`, `area.created`, `area.updated`, `area.deleted`, `device.enrolled`, `device.updated`, `device.deleted`, `membership.invited`, `membership.accepted`, `membership.invitation_revoked`, `membership.added`, `membership.role_changed`, and `membership.removed`. Membership events use the affected account id as the entity id (invitation events use the invitation id). Refused or failed requests are not recorded.

## Organization switching in the UI

The sidebar workspace switcher lists every organization the signed-in account belongs to with the role held in each; the selection is remembered per account. The top bar always names the current organization and role, and the heading badge reflects what that role can do. The **Organization** page shows ownership context (owners, member and team counts), the member roster with per-team roles, team administration, pending invitations, and the invitation form. With no organization selected, or from the switcher's "New organization" entry, it lists every organization of the account and lets any engineer start a new one with the same account.

## Tests

`npm test` runs the whole Vitest suite; `npm run test:watch` keeps it running, `npm run test:server` / `npm run test:client` run one project, and `npm run test:coverage` adds a V8 coverage report (text summary plus `coverage/index.html`). Vitest is configured with two projects in `vitest.config.ts`:

- `server` boots the real Fastify application in-process with `app.inject()` against a private SQLite file per test file (`tests/server/setup/environment.ts` sets `NODE_ENV=test` and the database path before any server module loads).
  - `tests/server/api/` — login and session lifecycle, tenant isolation, role permissions (including engineers in several teams of one organization and in several organizations), request validation, CRUD scope boundaries, organizations, teams, memberships, invitations, the audit trail, and HTTP hardening (origin checks, rate limiting, body limits).
  - `tests/server/persistence/` — migration runner guarantees, uniqueness constraints, foreign-key relationships, deletion safeguards, and the development/production seeding rules.
  - `tests/server/unit/` — the permission matrix, configuration validation, authorization and route guards, service-level guards that do not depend on the HTTP layer, password hashing, the scope-to-SQL builder, and authentication primitives.
- `client` renders React components in jsdom with Testing Library and the `api` module mocked (`tests/client/helpers/api-mock.ts`).
  - `tests/client/App.test.tsx` — session bootstrap, sign-in and sign-out, 401 handling, and every invitation-link route (new person, existing account signed out or signed in, invalid link).
  - `tests/client/components/` — the auth screens, role-gated controls on every management panel (networks, areas, device enrollment and management, teams, members, invitations), the Organization page, the workspace switcher, organization switching and data scoping in the dashboard, the dashboard pages, and the device table.
  - `tests/client/api/` and `tests/client/lib/` — the `fetch` wrapper (credentials, headers, `ApiError` mapping) and the endpoint-to-route contract for every API call, plus the overview and area metrics.

`tests/server/helpers/fixtures.ts` seeds the demo inventory from `server/persistence/demo-fixtures.ts` plus test-only accounts that cover every role. Each server test runs inside a transaction that is rolled back afterwards, so tests never depend on each other's writes. Tests are type-checked by `npm run typecheck` through `tsconfig.test.json` and `tsconfig.test.client.json`, and linted with the rest of the code.

## Current limits

Monitoring is based on illustrative fixtures. Device enrollment creates a `Pending` inventory record with no last-seen time until a collector reports in; changing its management address resets it to `Pending`. Live collectors, topology discovery, email delivery, SSO, password recovery, account deactivation through the API, and organization deletion are not implemented; an organization with audit history cannot be deleted at the database level either. The server currently supports one SQLite process and is intended for a trusted single deployment, not horizontally scaled instances. Extend the test suite alongside any new write operation or change to the authorization model.
