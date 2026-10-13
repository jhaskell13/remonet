import type { Area, AreaSummary, Device, Network, NetworkOverview } from '../../shared/network.ts';
import type { OrganizationMembership, Session } from '../types.ts';
import { DeviceTable, Stat, Topology } from './NetworkWidgets.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { NetworkManagement } from './NetworkManagement.tsx';
import { AreaManagement } from './AreaManagement.tsx';

export type DashboardPage = 'Overview' | 'Devices' | 'Topology' | 'Areas' | 'Activity' | 'Settings';
export type DeviceFilter = 'All devices' | 'Healthy' | 'Warning' | 'Offline';
type DashboardViewsProps = {
  page: DashboardPage;
  overview: NetworkOverview;
  devices: Device[];
  areas: Area[];
  filtered: Device[];
  areaSummaries: AreaSummary[];
  query: string;
  onQueryChange: (query: string) => void;
  filter: DeviceFilter;
  onFilterChange: (filter: DeviceFilter) => void;
  onNavigate: (page: DashboardPage) => void;
  user: Session['user'];
  organizations: OrganizationMembership[];
  organizationId: string;
  networks: Network[];
  networkId: string;
  onResourcesChanged: () => void;
  canManageNetworks: boolean;
};
const statusClass = (status: string) => status.toLowerCase();
export function DashboardViews(props: DashboardViewsProps) {
  const {
    page,
    overview,
    devices,
    areas,
    filtered,
    areaSummaries,
    query,
    onQueryChange,
    filter,
    onFilterChange,
    onNavigate,
    user,
    organizations,
    organizationId,
    networks,
    networkId,
    onResourcesChanged,
    canManageNetworks,
  } = props;
  return (
    <>
      {page === 'Overview' && (
        <>
          <div className="stats-grid">
            <Stat
              label="Total devices"
              value={String(overview.totalDevices)}
              detail={`Across ${overview.areas} areas`}
              icon="▤"
              accent="blue"
            />
            <Stat
              label="Online"
              value={String(overview.online)}
              detail={`${overview.online} healthy devices`}
              icon="✓"
              accent="green"
            />
            <Stat
              label="Needs attention"
              value={String(overview.needsAttention)}
              detail={`${overview.warning} warnings · ${overview.offline} offline`}
              icon="!"
              accent="amber"
            />
            <Stat
              label="Network health"
              value={`${overview.healthScore}%`}
              detail="Healthy devices"
              icon="⌁"
              accent="violet"
            />
          </div>
          <div className="overview-grid">
            <section className="panel topology-panel">
              <div className="panel-header">
                <div>
                  <h2>Network topology</h2>
                  <p>Live view of your connected infrastructure</p>
                </div>
                <button className="text-button" onClick={() => onNavigate('Topology')}>
                  View full map <span>→</span>
                </button>
              </div>
              <Topology />
            </section>
            <section className="panel health-panel">
              <div className="panel-header">
                <div>
                  <h2>Network health</h2>
                  <p>Device status across all areas</p>
                </div>
                <button className="more-button">···</button>
              </div>
              <div className="health-score">
                <div
                  className="health-ring"
                  style={{
                    background: `conic-gradient(#41b982 0deg ${overview.healthScore * 3.6}deg, #edf2f4 ${overview.healthScore * 3.6}deg 360deg)`,
                  }}
                >
                  <div>
                    <strong>{overview.healthScore}</strong>
                    <small>/ 100</small>
                  </div>
                </div>
                <div>
                  <b>{overview.needsAttention ? 'Needs attention' : 'Network is healthy'}</b>
                  <p>
                    {overview.needsAttention
                      ? `${overview.needsAttention} devices need review.`
                      : 'All devices are operating normally.'}
                  </p>
                </div>
              </div>
              <div className="health-breakdown">
                <div>
                  <span>
                    <i className="legend-dot healthy"></i>Healthy
                  </span>
                  <b>{overview.healthy}</b>
                </div>
                <div>
                  <span>
                    <i className="legend-dot warning"></i>Warning
                  </span>
                  <b>{overview.warning}</b>
                </div>
                <div>
                  <span>
                    <i className="legend-dot offline"></i>Offline
                  </span>
                  <b>{overview.offline}</b>
                </div>
              </div>
              <button
                className="outline-button"
                onClick={() => {
                  onNavigate('Devices');
                  onFilterChange('Warning');
                }}
              >
                Review issues <span>→</span>
              </button>
            </section>
          </div>
          <div className="lower-grid">
            <section className="panel device-panel">
              <div className="panel-header">
                <div>
                  <h2>Devices</h2>
                  <p>Your network at a glance</p>
                </div>
                <button className="text-button" onClick={() => onNavigate('Devices')}>
                  View all <span>→</span>
                </button>
              </div>
              <DeviceTable rows={devices.slice(0, 4)} areas={areas} />
            </section>
            <section className="panel areas-panel">
              <div className="panel-header">
                <div>
                  <h2>Areas</h2>
                  <p>Health by location</p>
                </div>
                <button className="text-button" onClick={() => onNavigate('Areas')}>
                  View all <span>→</span>
                </button>
              </div>
              <div className="area-list">
                {areaSummaries.slice(0, 3).map((a, i) => (
                  <div className="area-row" key={a.id}>
                    <div className={`area-icon area-${i}`}>{['⌂', '▦', '⌖'][i]}</div>
                    <div className="area-name">
                      <b>{a.name}</b>
                      <small>{a.region}</small>
                    </div>
                    <div className="area-count">
                      <b>
                        {a.healthy}/{a.totalDevices}
                      </b>
                      <small>devices</small>
                    </div>
                    <span
                      className={`status-pill ${statusClass(a.status === 'Operational' ? 'Healthy' : 'Warning')}`}
                    >
                      <i></i>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="panel events-panel">
            <div className="panel-header">
              <div>
                <h2>Recent activity</h2>
                <p>Latest events from your network</p>
              </div>
              <button className="text-button" onClick={() => onNavigate('Activity')}>
                View activity <span>→</span>
              </button>
            </div>
            <div className="event-row">
              <span className="event-symbol warning-symbol">!</span>
              <div>
                <b>High CPU utilization detected</b>
                <small>Edge Firewall · Data Center</small>
              </div>
              <span className="event-time">12 min ago</span>
              <span className="status-pill warning">
                <i></i>Warning
              </span>
            </div>
            <div className="event-row">
              <span className="event-symbol green-symbol">✓</span>
              <div>
                <b>Device came back online</b>
                <small>Core Router 01 · North Campus</small>
              </div>
              <span className="event-time">48 min ago</span>
              <span className="status-pill healthy">
                <i></i>Resolved
              </span>
            </div>
          </section>
        </>
      )}
      {page === 'Devices' && (
        <section className="panel full-panel">
          <div className="panel-header">
            <div>
              <h2>
                All devices <span className="subtle-count">{devices.length}</span>
              </h2>
              <p>Monitor and manage your network hardware</p>
            </div>
            <div className="table-actions">
              <label className="search-box">
                <span>⌕</span>
                <input
                  placeholder="Search devices..."
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                />
              </label>
              <select value={filter} onChange={(e) => onFilterChange(e.target.value as DeviceFilter)}>
                <option>All devices</option>
                <option>Healthy</option>
                <option>Warning</option>
                <option>Offline</option>
              </select>
            </div>
          </div>
          <DeviceTable rows={filtered} areas={areas} />
        </section>
      )}
      {page === 'Topology' && (
        <section className="panel full-panel">
          <div className="panel-header">
            <div>
              <h2>Network topology</h2>
              <p>Live view of your connected infrastructure</p>
            </div>
            <span className="live-indicator">
              <i></i> Live
            </span>
          </div>
          <Topology large />
        </section>
      )}
      {page === 'Areas' && (
        <div className="area-cards">
          {areaSummaries.map((a, i) => (
            <section className="panel area-card" key={a.name}>
              <div className={`area-icon area-${i}`}>{['⌂', '▦', '⌖', '⌂'][i]}</div>
              <span
                className={`status-pill ${statusClass(a.status === 'Operational' ? 'Healthy' : 'Warning')}`}
              >
                <i></i>
                {a.status}
              </span>
              <h2>{a.name}</h2>
              <p>{a.region}</p>
              <div className="area-card-metrics">
                <div>
                  <b>{a.totalDevices}</b>
                  <small>Total devices</small>
                </div>
                <div>
                  <b>{a.healthy}</b>
                  <small>Healthy</small>
                </div>
              </div>
              <div className="progress">
                <i style={{ width: `${a.totalDevices ? (a.healthy / a.totalDevices) * 100 : 0}%` }} />
              </div>
            </section>
          ))}
        </div>
      )}
      {page === 'Activity' && (
        <section className="panel full-panel">
          <div className="panel-header">
            <div>
              <h2>Recent activity</h2>
              <p>Latest events from your network</p>
            </div>
            <button className="outline-button">All events⌄</button>
          </div>
          {[
            [
              'warning-symbol',
              '!',
              'High CPU utilization detected',
              'Edge Firewall · Data Center',
              '12 min ago',
              'Warning',
            ],
            [
              'green-symbol',
              '✓',
              'Device came back online',
              'Core Router 01 · North Campus',
              '48 min ago',
              'Resolved',
            ],
            [
              'green-symbol',
              '↻',
              'Configuration backup completed',
              'Distribution Switch A · North Campus',
              '2 hours ago',
              'Success',
            ],
            [
              'warning-symbol',
              '!',
              'Packet loss above threshold',
              'Warehouse Access Point · West Warehouse',
              '3 hours ago',
              'Warning',
            ],
            [
              'green-symbol',
              '✓',
              'Firmware update completed',
              'Branch Gateway · East Office',
              'Yesterday',
              'Success',
            ],
          ].map((row) => (
            <div className="event-row activity-row" key={row[2]}>
              <span className={`event-symbol ${row[0]}`}>{row[1]}</span>
              <div>
                <b>{row[2]}</b>
                <small>{row[3]}</small>
              </div>
              <span className="event-time">{row[4]}</span>
              <span className={`status-pill ${row[5] === 'Warning' ? 'warning' : 'healthy'}`}>
                <i></i>
                {row[5]}
              </span>
            </div>
          ))}
        </section>
      )}
      {page === 'Settings' && (
        <>
          <NetworkManagement
            networks={networks}
            organizationId={organizationId}
            canManage={canManageNetworks}
            onChanged={onResourcesChanged}
          />
          <AreaManagement
            areas={areas}
            network={networks.find((network) => network.id === networkId)}
            canManage={canManageNetworks}
            onChanged={onResourcesChanged}
          />
          <section className="panel settings-panel">
            <h2>Workspace settings</h2>
            <p>Signed in as {user.email}</p>
            <div className="settings-row">
              <div>
                <b>Organization access</b>
                <small>Your membership controls which organizations and networks are available.</small>
              </div>
              <span>{organizations.length} organizations</span>
            </div>
            <div className="settings-row">
              <div>
                <b>API access</b>
                <small>Browser sessions are private and stored server-side.</small>
              </div>
              <span className="status-pill healthy">
                <i></i>Protected
              </span>
            </div>
          </section>
          <InvitePanel
            organizationId={organizationId}
            role={organizations.find((org) => org.id === organizationId)?.role ?? 'viewer'}
          />
        </>
      )}
    </>
  );
}
