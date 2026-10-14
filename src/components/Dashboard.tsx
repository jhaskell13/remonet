import { useEffect, useMemo, useState } from 'react';
import { DashboardViews, type DashboardPage, type DeviceFilter } from './DashboardViews.tsx';
import { RoleBadge } from './RoleBadge.tsx';
import { roleLabels } from '../lib/roles.ts';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.tsx';
import { api, ApiError } from '../api/client.ts';
import { getAreaSummaries, getOverview } from '../lib/network-metrics.ts';
import type { Area, Device, Network } from '../../shared/network.ts';
import { hasPermission } from '../../shared/permissions.ts';
import type { OrganizationMembership, Session } from '../types.ts';

const selectionKey = (userId: string) => `remonet.organization.${userId}`;
function rememberedOrganization(userId: string, organizations: OrganizationMembership[]) {
  try {
    const stored = window.localStorage.getItem(selectionKey(userId));
    if (
      stored !== null &&
      (stored === '' || organizations.some((organization) => organization.id === stored))
    )
      return stored;
  } catch {
    /* Storage may be unavailable; fall back to the first organization. */
  }
  return organizations[0]?.id ?? '';
}

const nav: { name: DashboardPage; icon: string }[] = [
  { name: 'Overview', icon: '◫' },
  { name: 'Devices', icon: '▤' },
  { name: 'Topology', icon: '⌘' },
  { name: 'Areas', icon: '⌖' },
  { name: 'Activity', icon: '◷' },
];
function Dashboard({
  user,
  organizations,
  onLogout,
  onSessionChanged,
}: {
  user: Session['user'];
  organizations: OrganizationMembership[];
  onLogout: () => void;
  onSessionChanged: () => Promise<void>;
}) {
  const [page, setPage] = useState<DashboardPage>('Overview');
  const [createOrganizationRequest, setCreateOrganizationRequest] = useState(0);
  function navigate(nextPage: DashboardPage) {
    setPage(nextPage);
    setCreateOrganizationRequest(0);
  }
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DeviceFilter>('All devices');
  const [selectedOrganizationId, setOrganizationId] = useState(() =>
    rememberedOrganization(user.id, organizations),
  );
  const [networkId, setNetworkId] = useState('');
  // Membership can be revoked while signed in; fall back to the first organization rather than
  // keeping a selection the account can no longer see.
  const organizationId =
    selectedOrganizationId &&
    !organizations.some((organization) => organization.id === selectedOrganizationId)
      ? (organizations[0]?.id ?? '')
      : selectedOrganizationId;
  const currentOrganization = organizations.find((organization) => organization.id === organizationId);
  function selectOrganization(nextOrganizationId: string) {
    setOrganizationId(nextOrganizationId);
    setNetworkId('');
    setCreateOrganizationRequest(0);
    try {
      window.localStorage.setItem(selectionKey(user.id), nextOrganizationId);
    } catch {
      /* Storage is optional. */
    }
  }
  const [networks, setNetworks] = useState<Network[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [areas, setAreas] = useState<Area[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [overview, setOverview] = useState(getOverview([], []));
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true);
      setDataError('');
      try {
        const filters = {
          ...(organizationId ? { organizationId } : {}),
          ...(networkId ? { networkId } : {}),
        };
        const [networkResult, areaResult, deviceResult, overviewResult] = await Promise.all([
          api.networks(organizationId ? { organizationId } : {}),
          api.areas(filters),
          api.devices(filters),
          api.overview(filters),
        ]);
        if (current) {
          setNetworks(networkResult.data);
          setAreas(areaResult.data);
          setDevices(deviceResult.data);
          setOverview(overviewResult.data);
        }
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          void onLogout();
          return;
        }
        if (current) setDataError(reason instanceof Error ? reason.message : 'Could not load network data.');
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [organizationId, networkId, dataVersion, onLogout]);
  const filtered = useMemo(
    () =>
      devices.filter(
        (device) =>
          (filter === 'All devices' || device.status === filter) &&
          `${device.name} ${device.id} ${areas.find((area) => area.id === device.areaId)?.name ?? device.areaId} ${device.type}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [query, filter, devices, areas],
  );
  const areaSummaries = getAreaSummaries(devices, areas);
  const canManageNetworks = hasPermission(currentOrganization?.role, 'network.manage');
  const canEnrollDevices = hasPermission(currentOrganization?.role, 'device.enroll');
  if (loading && !devices.length && !dataError)
    return <div className="auth-loading">Loading your network…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>
            Remo<span className="brand-light">Net</span>
          </span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <WorkspaceSwitcher
          organizations={organizations}
          organizationId={organizationId}
          email={user.email}
          onSelect={selectOrganization}
          onCreate={() => {
            selectOrganization('');
            setPage('Organization');
            setCreateOrganizationRequest((request) => request + 1);
          }}
        />
        <div className="nav-label">MONITOR</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.name}
              onClick={() => navigate(item.name)}
              className={`nav-item ${page === item.name ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
              {item.name === 'Devices' && <span className="nav-count">{devices.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="nav-label">SYSTEM</div>
          <button
            onClick={() => navigate('Organization')}
            className={`nav-item ${page === 'Organization' ? 'active' : ''}`}
          >
            <span className="nav-icon">◎</span>Organization
            <span className="nav-count">{organizations.length}</span>
          </button>
          <button
            onClick={() => navigate('Settings')}
            className={`nav-item ${page === 'Settings' ? 'active' : ''}`}
          >
            <span className="nav-icon">⚙</span>Settings
          </button>
          <div className="help-card">
            <span className="help-icon">?</span>
            <b>Need a hand?</b>
            <p>Visit the docs or contact your workspace admin.</p>
            <button onClick={() => navigate('Settings')}>
              Open documentation <span>↗</span>
            </button>
          </div>
          <div className="user-profile">
            <div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div>
            <div>
              <b>{user.displayName}</b>
              <small>Network engineer</small>
            </div>
            <button className="signout-button" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            {currentOrganization?.name ?? 'All organizations'} <span>/</span> <b>{page}</b>
          </div>
          <div className="top-actions">
            {currentOrganization ? (
              <span className="live-indicator" title={`Your role in ${currentOrganization.name}`}>
                <RoleBadge role={currentOrganization.role} /> in {currentOrganization.name}
              </span>
            ) : (
              <span className="live-indicator">
                <i></i> {organizations.length} {organizations.length === 1 ? 'organization' : 'organizations'}
              </span>
            )}
            <div className="top-avatar">{user.displayName.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>
        <section className="content">
          {dataError && <div className="data-error">{dataError}</div>}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                NETWORK MONITORING <span>•</span> {overview.totalDevices} devices
              </div>
              <h1>{page === 'Overview' ? `Welcome, ${user.displayName}` : page}</h1>
              <p>
                {page === 'Overview'
                  ? 'Here’s what’s happening across your selected network.'
                  : page === 'Devices'
                    ? 'Monitor devices across your organization and networks.'
                    : page === 'Topology'
                      ? 'See how your network devices connect across areas.'
                      : page === 'Areas'
                        ? 'Network health across your locations.'
                        : page === 'Activity'
                          ? 'Recent events from across your network.'
                          : page === 'Organization'
                            ? 'Teams, members, roles, and invitations for the selected organization.'
                            : 'Manage your workspace preferences.'}
              </p>
            </div>
            <div className="heading-actions">
              <select
                aria-label="Organization"
                value={organizationId}
                onChange={(event) => selectOrganization(event.target.value)}
              >
                <option value="">All organizations</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Network"
                value={networkId}
                onChange={(event) => setNetworkId(event.target.value)}
              >
                <option value="">All networks</option>
                {networks.map((network) => (
                  <option key={network.id} value={network.id}>
                    {network.name}
                  </option>
                ))}
              </select>
              <span className="read-only-badge">
                {!currentOrganization
                  ? 'Read only'
                  : currentOrganization.role === 'viewer'
                    ? 'Viewer · read only'
                    : `${roleLabels[currentOrganization.role]} controls`}
              </span>
            </div>
          </div>
          <DashboardViews
            page={page}
            overview={overview}
            devices={devices}
            areas={areas}
            filtered={filtered}
            areaSummaries={areaSummaries}
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
            onNavigate={navigate}
            user={user}
            organizations={organizations}
            organizationId={organizationId}
            networks={networks}
            networkId={networkId}
            onResourcesChanged={() => setDataVersion((version) => version + 1)}
            canManageNetworks={canManageNetworks}
            canEnrollDevices={canEnrollDevices}
            onSelectOrganization={selectOrganization}
            onSessionChanged={onSessionChanged}
            onLogout={onLogout}
            createOrganizationRequest={createOrganizationRequest}
          />
          <footer className="footer">
            <span>
              RemoNet <span>·</span> Network operations, made clearer.
            </span>
            <span>
              <i></i> API connected <span>·</span> v0.1.0
            </span>
          </footer>
        </section>
      </main>
    </div>
  );
}
export default Dashboard;
