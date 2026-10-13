# RemoNet Development Roadmap

This roadmap puts the project’s major capabilities in dependency order. It describes intended milestones rather than release dates; each milestone should be scoped and reviewed before implementation begins.

## Current foundation

The project has a local React/TypeScript dashboard and a TypeScript/Fastify API backed by SQLite. It already supports:

- Personal engineer accounts, cookie sessions, invitations, teams, organization memberships, and organization-scoped reads.
- Role-checked creation and editing of networks and areas.
- Device enrollment, editing, movement between areas in the same network, and removal.
- Pending inventory state for devices that have not reported a monitoring result.
- SQL migrations, API request validation, centralized errors, and basic API security controls.

The dashboard still includes illustrative activity, topology, and device status data. There is no live collector, metric history, alerting workflow, or organization/team administration UI yet. SQLite currently assumes one API process.

## Milestones

### 1. Authorization and data-integrity baseline

**Goal:** Make the existing organization and device write flows safe to extend.

- Add API tests for login/session lifecycle, tenant isolation, role permissions, validation, and CRUD scope boundaries.
- Add migration and repository tests for uniqueness, foreign-key relationships, and deletion safeguards.
- Review role behavior across multiple teams in one organization and multiple organizations per engineer.
- Add an audit trail for security-sensitive changes such as membership, network, area, and device changes.

**Done when:** Tests prove that a user cannot read or mutate another organization’s resources, and destructive operations cannot bypass their domain constraints.

### 2. Organization and team administration

**Goal:** Let a trusted team manage its own workspace as the number of organizations grows.

- Create organizations and teams through explicit owner-controlled workflows.
- Manage memberships, invitations, role changes, and member removal.
- Define and document the permission matrix for owner, admin, operator, and viewer.
- Support a person belonging to several teams and organizations without duplicating accounts.
- Provide organization switching and clear ownership context in the UI.

**Done when:** An owner can create a workspace, invite engineers, assign roles, and remove access; each engineer sees only resources granted by membership.

### 3. Monitoring data model and status history

**Goal:** Separate inventory from observations collected over time.

- Store timestamped check results and measurements instead of overwriting the only copy of device health data.
- Record collection source, result, latency, and error details with bounded retention.
- Define when a device is Pending, Healthy, Warning, or Offline, including stale-data behavior.
- Make dashboard health metrics derive from observations and show when data was last updated.

**Done when:** Device status can be reconstructed from persisted observations, and pending or stale devices are not presented as recently checked.

### 4. Collector framework and simulator

**Goal:** Add collection behavior behind a protocol-independent boundary.

- Define a collector interface for checks, measurements, errors, and cancellation.
- Add a scheduler with timeouts, bounded concurrency, retry/backoff, and per-network controls.
- Implement a simulator first so the end-to-end collection path can be exercised without hardware.
- Make collector runs observable through structured logs and collection state.

**Done when:** A simulated check produces persisted observations and updates dashboard status using the same path intended for real collectors.

### 5. First real monitoring integration

**Goal:** Poll a small, well-defined set of real network devices safely.

- Choose the deployment model: collector beside the API, a collector near each network, or a managed agent.
- Start with read-only SNMPv3 where supported; add other protocols only for a clear device requirement.
- Store credentials as secrets, keep them out of logs and normal API responses, and support rotation.
- Restrict collector egress and validate configured targets to reduce the risk of unintended network access.
- Add a small supported-device matrix and clear unsupported/check-failed states.

**Done when:** An operator can configure a supported device, run a real check from a reachable collector, and see fresh measurements and understandable failures.

### 6. Alerts and incident workflow

**Goal:** Turn status changes into actionable, traceable work.

- Create events on meaningful state transitions and threshold breaches, with deduplication and recovery events.
- Add filtering, acknowledgement, assignment, and resolution in the UI.
- Add notification channels after event behavior is reliable; make delivery retries and failures visible.
- Scope events and notification settings to their organization.

**Done when:** Engineers can identify, assign, acknowledge, and resolve an issue without duplicate alert noise.

### 7. Topology discovery and maps

**Goal:** Replace the illustrative topology view with discovered or curated relationships.

- Persist links and discovery observations with source and last-seen timestamps.
- Begin with one supported source such as LLDP from a collector, with manual corrections where discovery is incomplete.
- Show network, area, device, and link state with useful filters and stale-link indicators.
- Keep uncertain or conflicting discoveries visible as such rather than presenting them as certain.

**Done when:** An engineer can navigate a real network map, inspect why a link exists, and distinguish current observations from stale data.

### 8. Production operations and release readiness

**Goal:** Operate the service reliably for real teams and multiple organizations.

- Add backups and restore procedures, migration rollout guidance, operational metrics, and log retention.
- Add rate and resource limits for collection workloads, and verify graceful shutdown behavior.
- Document HTTPS/reverse-proxy deployment, secret management, network reachability, and incident response.
- Revisit SQLite versus a server database before multi-process or horizontally scaled deployment.
- Complete security review, accessibility review, dependency review, and end-to-end acceptance coverage.

**Done when:** A fresh deployment can be configured reproducibly, data can be restored, failures are diagnosable, and access boundaries are verified before release.

## Working principles

- Keep organization identifiers on every tenant-owned record and enforce scope in service and repository operations.
- Use additive, immutable SQL migrations; preserve existing data and document operational effects.
- Keep collection adapters independent of HTTP routes and UI components.
- Prefer read-only collection first. Any device configuration or command execution needs a separate permission and audit design.
- Keep credentials in server-side secret storage and never return them through the API.
- Add automated tests before expanding the real monitoring and authorization surface.
- Keep the local development loop simple: `npm run dev:api` and `npm run dev` in separate terminals; production builds are only needed for deployment work.

## Decisions to resolve before the related milestones

- Which device vendors and protocols are needed for the first real deployment?
- Can the API host reach customer networks, or will collectors run inside those networks?
- What measurement history and event retention do teams need?
- Which notification destinations matter first?
- What does “cross-organization” mean operationally: one engineer with memberships in several independent organizations, or shared networks visible to multiple organizations?
