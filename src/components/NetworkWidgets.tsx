import type { ReactNode } from 'react';
import type { Area, Device } from '../data.ts';

const statusClass = (status: string) => status.toLowerCase();

export function Stat({label,value,detail,icon,accent}:{label:string;value:string;detail:ReactNode;icon:string;accent:string}) {
  return <div className="panel stat-card"><div className={`stat-icon ${accent}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-detail">{detail}</span></div>;
}

export function DeviceTable({rows,areas}:{rows:Device[];areas:Area[]}) {
  return <div className="table-wrap"><table><thead><tr><th>DEVICE</th><th>AREA</th><th>IP ADDRESS</th><th>STATUS</th><th>LATENCY</th><th></th></tr></thead><tbody>{rows.map(device=><tr key={device.id}><td><div className="device-cell"><span className="device-type">{device.type === 'Router' ? '⌁' : device.type === 'Firewall' ? '⬡' : device.type === 'Access point' ? '◉' : '▦'}</span><span><b>{device.name}</b><small>{device.id} · {device.type}</small></span></div></td><td>{areas.find(area => area.id === device.areaId)?.name ?? device.areaId}</td><td className="mono">{device.address}</td><td><span className={`status-pill ${statusClass(device.status)}`}><i></i>{device.status}</span></td><td>{device.status === 'Offline' ? '—' : `${device.latency} ms`}</td><td><button className="row-menu">···</button></td></tr>)}</tbody></table>{rows.length===0&&<div className="empty-state">No devices match your search.</div>}</div>;
}

export function Topology({large=false}:{large?:boolean}) {
  return <div className={`topology-canvas ${large?'large':''}`}><div className="map-label top-left"><span className="legend-dot healthy"/>Healthy <span className="legend-dot warning"/>Warning <span className="legend-dot offline"/>Offline</div><svg className="connections" viewBox="0 0 800 340" preserveAspectRatio="none"><path d="M400 74 L225 155 M400 74 L575 155 M225 155 L122 248 M225 155 L325 248 M575 155 L480 248 M575 155 L680 248"/><path className="dashed" d="M122 248 L325 248"/></svg><div className="node core-node"><span className="node-symbol">⌁</span><b>Core Router</b><small>10.20.0.1</small><i/></div><div className="node branch-node branch-left"><span className="node-symbol">▦</span><b>North Campus</b><small>24 devices</small><i/></div><div className="node branch-node branch-right"><span className="node-symbol">⬡</span><b>Data Center</b><small>18 devices</small><i className="node-warning"/></div><div className="node leaf-node leaf-1"><span className="node-symbol">▤</span><b>Dist. Switch A</b><small>Healthy</small><i/></div><div className="node leaf-node leaf-2"><span className="node-symbol">◉</span><b>Access Points</b><small>12 devices</small><i className="node-warning"/></div><div className="node leaf-node leaf-3"><span className="node-symbol">▦</span><b>Core Switches</b><small>Healthy</small><i/></div><div className="node leaf-node leaf-4"><span className="node-symbol">◉</span><b>Warehouse AP</b><small>Offline</small><i className="node-offline"/></div><div className="map-label map-caption">Simplified topology · Device connections are illustrative</div></div>;
}
