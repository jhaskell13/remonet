import { useEffect, useMemo, useState } from 'react';
import { InvitationScreen, LoginScreen } from './components/AuthScreens';
import type { Invitation, OrganizationMembership, Session } from './types';
import { DeviceTable, Stat, Topology } from './components/NetworkWidgets';
import { InvitePanel } from './components/InvitePanel';
import { getAreaSummaries, getOverview, type Area, type Device, type Network } from './data';
import './style.css';

type Page = 'Overview' | 'Devices' | 'Topology' | 'Areas' | 'Activity' | 'Settings';
const nav: { name: Page; icon: string }[] = [ { name: 'Overview', icon: '◫' }, { name: 'Devices', icon: '▤' }, { name: 'Topology', icon: '⌘' }, { name: 'Areas', icon: '⌖' }, { name: 'Activity', icon: '◷' } ];
const statusClass = (status: string) => status.toLowerCase();

function readInviteToken() { return new URLSearchParams(window.location.hash.slice(1)).get('invite'); }
function clearInviteToken() { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); }

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    let active = true;
    async function initialize() {
      const token = readInviteToken();
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok && active) setSession(await response.json() as Session);
      } catch { /* The login screen will show a useful error when the API is unavailable. */ }
      if (token) {
        try {
          const response = await fetch('/api/invitations/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
          const result = await response.json() as { data?: Omit<Invitation, 'token'>; error?: string };
          if (!response.ok) throw new Error(result.error ?? 'This invitation is invalid or expired.');
          if (active && result.data) setInvitation({ token, ...result.data });
        } catch (reason) { if (active) setInviteError(reason instanceof Error ? reason.message : 'Could not verify this invitation.'); }
      }
      if (active) setCheckingSession(false);
    }
    void initialize();
    return () => { active = false; };
  }, []);
  async function login(email: string, password: string) {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const result = await response.json() as Session & { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Sign in failed.');
    setSession(result);
  }
  async function acceptInvitation(input: { token: string; displayName?: string; password?: string }) {
    const response = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json() as Session & { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Could not accept invitation.');
    setSession(result); setInvitation(null); setInviteError(''); clearInviteToken();
  }
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession(null);
  }
  if (checkingSession) return <div className="auth-loading">Connecting to RemoNet…</div>;
  if (inviteError) return <main className="auth-screen"><section className="auth-card"><div className="brand auth-brand">Remo<span className="brand-light">Net</span></div><h1>Invitation unavailable</h1><p>{inviteError}</p><button className="outline-button" onClick={() => { clearInviteToken(); setInviteError(''); }}>Return to sign in</button></section></main>;
  if (invitation && session) return <InvitationScreen invitation={invitation} session={session} onAccept={acceptInvitation} onLogout={logout} />;
  if (invitation && !session && !invitation.accountExists) return <InvitationScreen invitation={invitation} onAccept={acceptInvitation} />;
  if (!session) return <LoginScreen onLogin={login} invitation={invitation} />;
  return <Dashboard user={session.user} organizations={session.organizations} onLogout={logout} />;
}

function Dashboard({ user, organizations, onLogout }: { user: Session['user']; organizations: OrganizationMembership[]; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('Overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All devices');
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [networkId, setNetworkId] = useState('');
  const [networks, setNetworks] = useState<Network[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [overview, setOverview] = useState(getOverview([], []));
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  useEffect(() => {
    let current = true;
    async function load() {
      setLoading(true); setDataError('');
      const organizationParams = new URLSearchParams();
      if (organizationId) organizationParams.set('organizationId', organizationId);
      const networkParams = new URLSearchParams(organizationParams);
      if (networkId) networkParams.set('networkId', networkId);
      try {
        const [networkResponse, areaResponse, deviceResponse, overviewResponse] = await Promise.all([
          fetch(`/api/networks?${organizationParams}`), fetch(`/api/areas?${networkParams}`),
          fetch(`/api/devices?${networkParams}`), fetch(`/api/overview?${networkParams}`)
        ]);
        if ([networkResponse, areaResponse, deviceResponse, overviewResponse].some(response => response.status === 401)) { onLogout(); return; }
        if ([networkResponse, areaResponse, deviceResponse, overviewResponse].some(response => !response.ok)) throw new Error('Could not load network data.');
        const [networkData, areaData, deviceData, overviewData] = await Promise.all([
          networkResponse.json(), areaResponse.json(), deviceResponse.json(), overviewResponse.json()
        ]) as [{ data: Network[] }, { data: Area[] }, { data: Device[] }, { data: ReturnType<typeof getOverview> }];
        if (current) { setNetworks(networkData.data); setAreas(areaData.data); setDevices(deviceData.data); setOverview(overviewData.data); }
      } catch (reason) {
        if (current) setDataError(reason instanceof Error ? reason.message : 'Could not load network data.');
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [organizationId, networkId]);
  const filtered = useMemo(() => devices.filter(device => (filter === 'All devices' || device.status === filter) && `${device.name} ${device.id} ${areas.find(area => area.id === device.areaId)?.name ?? device.areaId} ${device.type}`.toLowerCase().includes(query.toLowerCase())), [query, filter, devices, areas]);
  const areaSummaries = getAreaSummaries(devices, areas);
  if (loading && !devices.length && !dataError) return <div className="auth-loading">Loading your network…</div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><i></i><i></i><i></i><i></i></span><span>Remo<span className="brand-light">Net</span></span></div>
      <div className="workspace-label">WORKSPACE</div><div className="workspace"><span className="workspace-icon">{(organizations.find(org => org.id === organizationId)?.name ?? 'R').slice(0, 1)}</span><span className="workspace-text"><b>{organizations.find(org => org.id === organizationId)?.name ?? 'No organization'}</b><small>{user.email}</small></span></div>
      <div className="nav-label">MONITOR</div><nav>{nav.map(item => <button key={item.name} onClick={() => setPage(item.name)} className={`nav-item ${page === item.name ? "active" : ""}`}><span className="nav-icon">{item.icon}</span>{item.name}{item.name === "Devices" && <span className="nav-count">{devices.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="nav-label">SYSTEM</div><button onClick={() => setPage("Settings")} className={`nav-item ${page === "Settings" ? "active" : ""}`}><span className="nav-icon">⚙</span>Settings</button><div className="help-card"><span className="help-icon">?</span><b>Need a hand?</b><p>Visit the docs or contact your workspace admin.</p><button onClick={() => setPage("Settings")}>Open documentation <span>↗</span></button></div><div className="user-profile"><div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div><div><b>{user.displayName}</b><small>Network engineer</small></div><button className="signout-button" onClick={onLogout}>Sign out</button></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumbs">{organizations.find(org => org.id === organizationId)?.name ?? 'RemoNet'} <span>/</span> <b>{page}</b></div><div className="top-actions"><span className="live-indicator"><i></i> API session active</span><div className="top-avatar">{user.displayName.slice(0, 2).toUpperCase()}</div></div></header>
    <section className="content">
      {dataError && <div className="data-error">{dataError}</div>}
      <div className="page-heading"><div><div className="eyebrow">NETWORK MONITORING <span>•</span> {overview.totalDevices} devices</div><h1>{page === 'Overview' ? `Welcome, ${user.displayName}` : page}</h1><p>{page === 'Overview' ? 'Here’s what’s happening across your selected network.' : page === 'Devices' ? 'Monitor devices across your organization and networks.' : page === 'Topology' ? 'See how your network devices connect across areas.' : page === 'Areas' ? 'Network health across your locations.' : page === 'Activity' ? 'Recent events from across your network.' : 'Manage your workspace preferences.'}</p></div><div className="heading-actions"><select aria-label="Organization" value={organizationId} onChange={event => { setOrganizationId(event.target.value); setNetworkId(''); }}><option value="">All organizations</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select><select aria-label="Network" value={networkId} onChange={event => setNetworkId(event.target.value)}><option value="">All networks</option>{networks.map(network => <option key={network.id} value={network.id}>{network.name}</option>)}</select><span className="read-only-badge">Read only</span></div></div>
      {page === 'Overview' && <>
        <div className="stats-grid"><Stat label="Total devices" value={String(overview.totalDevices)} detail={`Across ${overview.areas} areas`} icon="▤" accent="blue"/><Stat label="Online" value={String(overview.online)} detail={`${overview.online} healthy devices`} icon="✓" accent="green"/><Stat label="Needs attention" value={String(overview.needsAttention)} detail={`${overview.warning} warnings · ${overview.offline} offline`} icon="!" accent="amber"/><Stat label="Network health" value={`${overview.healthScore}%`} detail="Healthy devices" icon="⌁" accent="violet"/></div>
        <div className="overview-grid"><section className="panel topology-panel"><div className="panel-header"><div><h2>Network topology</h2><p>Live view of your connected infrastructure</p></div><button className="text-button" onClick={() => setPage('Topology')}>View full map <span>→</span></button></div><Topology/></section><section className="panel health-panel"><div className="panel-header"><div><h2>Network health</h2><p>Device status across all areas</p></div><button className="more-button">···</button></div><div className="health-score"><div className="health-ring" style={{background: `conic-gradient(#41b982 0deg ${overview.healthScore * 3.6}deg, #edf2f4 ${overview.healthScore * 3.6}deg 360deg)`}}><div><strong>{overview.healthScore}</strong><small>/ 100</small></div></div><div><b>{overview.needsAttention ? 'Needs attention' : 'Network is healthy'}</b><p>{overview.needsAttention ? `${overview.needsAttention} devices need review.` : 'All devices are operating normally.'}</p></div></div><div className="health-breakdown"><div><span><i className="legend-dot healthy"></i>Healthy</span><b>{overview.healthy}</b></div><div><span><i className="legend-dot warning"></i>Warning</span><b>{overview.warning}</b></div><div><span><i className="legend-dot offline"></i>Offline</span><b>{overview.offline}</b></div></div><button className="outline-button" onClick={() => {setPage('Devices');setFilter('Warning')}}>Review issues <span>→</span></button></section></div>
        <div className="lower-grid"><section className="panel device-panel"><div className="panel-header"><div><h2>Devices</h2><p>Your network at a glance</p></div><button className="text-button" onClick={() => setPage('Devices')}>View all <span>→</span></button></div><DeviceTable rows={devices.slice(0, 4)} areas={areas}/></section><section className="panel areas-panel"><div className="panel-header"><div><h2>Areas</h2><p>Health by location</p></div><button className="text-button" onClick={() => setPage('Areas')}>View all <span>→</span></button></div><div className="area-list">{areaSummaries.slice(0,3).map((a,i)=><div className="area-row" key={a.id}><div className={`area-icon area-${i}`}>{['⌂','▦','⌖'][i]}</div><div className="area-name"><b>{a.name}</b><small>{a.region}</small></div><div className="area-count"><b>{a.healthy}/{a.totalDevices}</b><small>devices</small></div><span className={`status-pill ${statusClass(a.status === 'Operational' ? 'Healthy' : 'Warning')}`}><i></i>{a.status}</span></div>)}</div></section></div>
        <section className="panel events-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Latest events from your network</p></div><button className="text-button" onClick={() => setPage('Activity')}>View activity <span>→</span></button></div><div className="event-row"><span className="event-symbol warning-symbol">!</span><div><b>High CPU utilization detected</b><small>Edge Firewall · Data Center</small></div><span className="event-time">12 min ago</span><span className="status-pill warning"><i></i>Warning</span></div><div className="event-row"><span className="event-symbol green-symbol">✓</span><div><b>Device came back online</b><small>Core Router 01 · North Campus</small></div><span className="event-time">48 min ago</span><span className="status-pill healthy"><i></i>Resolved</span></div></section>
      </>}
      {page === 'Devices' && <section className="panel full-panel"><div className="panel-header"><div><h2>All devices <span className="subtle-count">{devices.length}</span></h2><p>Monitor and manage your network hardware</p></div><div className="table-actions"><label className="search-box"><span>⌕</span><input placeholder="Search devices..." value={query} onChange={e=>setQuery(e.target.value)}/></label><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All devices</option><option>Healthy</option><option>Warning</option><option>Offline</option></select></div></div><DeviceTable rows={filtered} areas={areas}/></section>}
      {page === 'Topology' && <section className="panel full-panel"><div className="panel-header"><div><h2>Network topology</h2><p>Live view of your connected infrastructure</p></div><span className="live-indicator"><i></i> Live</span></div><Topology large/></section>}
      {page === 'Areas' && <div className="area-cards">{areaSummaries.map((a,i)=><section className="panel area-card" key={a.name}><div className={`area-icon area-${i}`}>{['⌂','▦','⌖','⌂'][i]}</div><span className={`status-pill ${statusClass(a.status === 'Operational' ? 'Healthy' : 'Warning')}`}><i></i>{a.status}</span><h2>{a.name}</h2><p>{a.region}</p><div className="area-card-metrics"><div><b>{a.totalDevices}</b><small>Total devices</small></div><div><b>{a.healthy}</b><small>Healthy</small></div></div><div className="progress"><i style={{width:`${a.totalDevices ? a.healthy/a.totalDevices*100 : 0}%`}}/></div></section>)}</div>}
      {page === 'Activity' && <section className="panel full-panel"><div className="panel-header"><div><h2>Recent activity</h2><p>Latest events from your network</p></div><button className="outline-button">All events⌄</button></div>{[['warning-symbol','!','High CPU utilization detected','Edge Firewall · Data Center','12 min ago','Warning'],['green-symbol','✓','Device came back online','Core Router 01 · North Campus','48 min ago','Resolved'],['green-symbol','↻','Configuration backup completed','Distribution Switch A · North Campus','2 hours ago','Success'],['warning-symbol','!','Packet loss above threshold','Warehouse Access Point · West Warehouse','3 hours ago','Warning'],['green-symbol','✓','Firmware update completed','Branch Gateway · East Office','Yesterday','Success']].map(row=><div className="event-row activity-row" key={row[2]}><span className={`event-symbol ${row[0]}`}>{row[1]}</span><div><b>{row[2]}</b><small>{row[3]}</small></div><span className="event-time">{row[4]}</span><span className={`status-pill ${row[5] === 'Warning' ? 'warning' : 'healthy'}`}><i></i>{row[5]}</span></div>)}</section>}
      {page === 'Settings' && <><section className="panel settings-panel"><h2>Workspace settings</h2><p>Signed in as {user.email}</p><div className="settings-row"><div><b>Organization access</b><small>Your membership controls which organizations and networks are available.</small></div><span>{organizations.length} organizations</span></div><div className="settings-row"><div><b>API access</b><small>Browser sessions are private and stored server-side.</small></div><span className="status-pill healthy"><i></i>Protected</span></div></section><InvitePanel organizationId={organizationId} role={organizations.find(org => org.id === organizationId)?.role ?? 'viewer'} /></>}
      <footer className="footer"><span>RemoNet <span>·</span> Network operations, made clearer.</span><span><i></i> API connected <span>·</span> v0.1.0</span></footer>
    </section></main>
  </div>;
}
export default App;






