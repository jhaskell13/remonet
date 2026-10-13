# RemoNet

RemoNet is a network operations dashboard starter for monitoring infrastructure across networks, areas, and organizations. It includes individual engineer accounts, team memberships, invitations, protected API routes, and illustrative local network data. Device data is read-only and seeded for now.

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
```

For local development, keep `npm run dev:api` and `npm run dev` running in separate terminals. You do not need to run `npm run build`; `dist/` is only created by a production build and can be removed when you want to clean generated output. TypeScript incremental metadata is stored under ignored `node_modules/.cache/` rather than the project root. `npm run start:api` runs the compiled API and expects a prior build.

## Architecture

The repository is one deployable application, split by runtime and responsibility instead of adding workspace/package overhead:

- `src/` contains the React/Vite client, screen components, and UI-only network metrics.
- `server/modules/` groups HTTP routes, controllers, and use-case services by feature.
- `server/http/` holds request authentication, access guards, and standardized error handling.
- `server/persistence/` owns the SQLite connection, SQL migrations, fixtures, query scoping, and repositories.
- `shared/` contains data contracts used by both client and API; it does not depend on either runtime.

The request flow is **route → controller → service → repository**. Controllers translate HTTP requests and responses; services enforce use-case rules; repositories own SQL. The schema is written in SQL and data access is explicit, so there is no ORM to obscure queries or add a large dependency tree.

## Database and migrations

The API opens SQLite through `better-sqlite3`, enables foreign keys, WAL journaling, a busy timeout, and normal synchronous mode. `server/persistence/migrations/` contains ordered, immutable SQL migrations. On startup the migration runner applies each migration in a transaction and stores its SHA-256 checksum. Editing an applied migration is rejected; add the next numbered migration instead.

The initial migration uses strict tables and relational constraints for organizations, networks, areas, devices, users, teams, memberships, invitations, and sessions. Existing local databases are preserved: the initial migration uses `CREATE TABLE IF NOT EXISTS`, then local fixture seeding fills any missing demo records.

For production bootstrap, set `NODE_ENV=production`, HTTPS `REMONET_ALLOWED_ORIGIN` and `REMONET_APP_ORIGIN`, and on an empty database provide `REMONET_BOOTSTRAP_EMAIL` and `REMONET_BOOTSTRAP_PASSWORD` (minimum 12 characters). RemoNet creates the first organization, owner team, and account. Remove bootstrap credentials after the first successful startup. Use a separate production database path; startup refuses a database containing demo organizations. Serve the UI and API under the same origin through a trusted VPN or HTTPS reverse proxy, and set `API_HOST` and the origins accordingly. Do not expose the API directly to the public internet.

## Authentication and API

Each engineer gets a personal account. Team membership grants organization access, and one account may belong to teams across several organizations. Roles are `owner`, `admin`, `operator`, and `viewer`; owners and admins can create seven-day invitation links. Invitees register with an individual account or sign in to join with an existing account.

Browser sessions use server-side session records and an `HttpOnly`, `SameSite=Strict` cookie, marked `Secure` in production. Passwords use Node's scrypt implementation. The API applies request schemas, a small body limit, rate limiting, security headers, exact-origin checks, and generic server errors with request IDs. Integration bearer credentials are optional server-only secrets; they must be at least 32 characters and can be limited with `REMONET_API_ORGANIZATION_IDS`. No public-key authentication is used.

Endpoints:

- `GET /api/health` and `GET /api/ready` — liveness and database readiness
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `POST /api/invitations`, `/api/invitations/inspect`, `/api/invitations/accept`
- `GET /api/organizations`, `/api/teams`, `/api/networks`, `/api/areas`, `/api/devices`, `/api/overview`

Network data endpoints accept `organizationId`, `networkId`, and `areaId` filters. The server intersects those filters with the authenticated principal's organization memberships.

## Current limits

Monitoring is based on illustrative fixtures. Live collectors, topology discovery, device changes, team administration, email delivery, SSO, password recovery, and audit history are not implemented. The server currently supports one SQLite process and is intended for a trusted single deployment, not horizontally scaled instances. Add automated tests before introducing production-facing write workflows or expanding the authorization model.
