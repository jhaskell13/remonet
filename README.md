# RemoNet

A lightweight starter dashboard for remote network operations. The React UI reads organization, network, area, device, and summary data through the authenticated API. The topology and activity feed are still illustrative placeholders.

## Run locally

Install dependencies with `npm install`. In one terminal start the API:

```powershell
npm run start:api
```

In a second terminal start the UI:

```powershell
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to port 3001 by default. The local development seed provides two example accounts; the sign-in page has buttons that fill in their credentials:

- **Solo engineer:** `solo@remonet.local` / `SoloNetwork2026!` — access to one personal organization and network.
- **Multi-org engineer:** `engineer@remonet.local` / `EngineerNetwork2026!` — access to Northstar Engineering and Acme Manufacturing through separate team memberships.

These known demo accounts are seeded only outside production, unless `REMONET_SEED_DEMO=false` disables them. Never use them for a deployed environment. The SQLite database is created at `data/remonet.sqlite`; set `REMONET_DB_PATH` to move it. The database is ignored by Git.

## Accounts, teams, and invitations

Each engineer has an individual account. Team membership grants access to an organization, and a user can belong to teams in multiple organizations. Current roles are `owner`, `admin`, `operator`, and `viewer`; only owners and admins can invite teammates. A solo engineer is represented by a personal organization and owner team.

In the app, choose an organization, open **Settings**, and create an invitation for an email, team, and role. RemoNet returns a link to copy and send to the invitee; there is no email delivery service yet. New invitees set their name and a password with at least 12 characters. If the email already has an account, that engineer signs in and accepts the invitation. Links expire after seven days and are stored as hashes in the database.

## Authentication and API

Browser sign-in uses an eight-hour `HttpOnly`, `SameSite=Strict` session cookie stored server-side in SQLite. Passwords are stored using Node's built-in scrypt password hashing. Login attempts are temporarily throttled after repeated failures. Set `NODE_ENV=production` behind HTTPS to enable the cookie's `Secure` attribute.

All network-data endpoints require a valid session or an integration bearer token. An integration token is optional and configured with `REMONET_API_TOKEN`; scope it using `REMONET_API_ORGANIZATION_IDS`. Tokens are secrets; no public-key authentication is used. The UI never receives the integration token.

- `POST /api/auth/login` — `{ "email": "engineer@example.com", "password": "…" }`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/invitations` — admin only; creates an invitation link
- `POST /api/invitations/inspect` — verifies a link token
- `POST /api/invitations/accept` — create an invited account or join an organization
- `GET /api/organizations`, `/api/teams`, `/api/networks`, `/api/areas`, `/api/devices`, `/api/overview`

Data endpoints accept optional `organizationId`, `networkId`, and `areaId` query parameters. The server intersects those filters with the authenticated user's team memberships, so request parameters cannot grant access to another organization.

## First owner outside the demo seed

Production mode does not create demo accounts or demo network data. On a fresh database, configure `REMONET_BOOTSTRAP_EMAIL` and `REMONET_BOOTSTRAP_PASSWORD` (minimum 12 characters) to create the first owner. RemoNet creates an initial organization (`REMONET_BOOTSTRAP_ORGANIZATION_ID`, default `org-remonet`; `REMONET_BOOTSTRAP_ORGANIZATION_NAME`, default `RemoNet Workspace`) and an Owners team for that account. You can also set `REMONET_BOOTSTRAP_DISPLAY_NAME`. Bootstrap runs only when there are no users.

## Current scope

The schema is at version 3 and uses stable IDs with organization → network → area → device relationships. It includes users, teams, memberships, hashed invitations, and persisted sessions. Monitoring data is still seeded and read-only; device management actions, live collectors, email delivery, SSO, and team management screens are not implemented. The local demo login uses known credentials for convenience and must remain disabled in production.
