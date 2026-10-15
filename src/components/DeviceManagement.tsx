import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Area, Device, DeviceObservation, DeviceType, Network } from '../../shared/network.ts';
import { describeObservation } from '../../shared/device-status.ts';
import { api, ApiError } from '../api/client.ts';
import { checkFollowUp } from '../lib/live-updates.ts';
import { formatRelativeTime, formatTimestamp } from '../lib/time.ts';

const statusClass = (status: string) => status.toLowerCase();

const deviceTypes: DeviceType[] = ['Router', 'Switch', 'Firewall', 'Access point', 'Other'];

export function DeviceManagement({
  devices,
  areas,
  network,
  canEdit,
  canDelete,
  onChanged,
}: {
  devices: Device[];
  areas: Area[];
  network: Network | undefined;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [areaId, setAreaId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>('Router');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<DeviceObservation[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<{
    deviceId: string;
    text: string;
    tone: 'info' | 'error';
  } | null>(null);
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(followUp.current ?? undefined), []);

  async function loadHistory(device: Pick<Device, 'id' | 'organizationId'>) {
    const result = await api.deviceObservations(device.id, {
      organizationId: device.organizationId,
      limit: 10,
    });
    return result.data;
  }

  // The dashboard refreshes the device list as checks land; keep an open history in step with it.
  useEffect(() => {
    const device = devices.find((candidate) => candidate.id === historyId);
    if (!device || loadingHistory) return;
    let current = true;
    loadHistory(device)
      .then((rows) => {
        if (current) setHistory(rows);
      })
      .catch(() => {
        /* The panel keeps what it has; the next refresh tries again. */
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices]);

  /** Watches for the observation a requested check produces and reports how it went. */
  function followCheck(device: Device, since: string, attempt = 1) {
    followUp.current = setTimeout(() => {
      void loadHistory(device)
        .then((rows) => {
          const latest = rows[0];
          if (latest && latest.createdAt > since) {
            const reading = describeObservation(latest);
            setCheckNotice({
              deviceId: device.id,
              tone: reading.status === 'Offline' ? 'error' : 'info',
              text: `Checked ${formatRelativeTime(latest.collectedAt)}: ${reading.label} — ${reading.detail}`,
            });
            if (historyId === device.id) setHistory(rows);
            return;
          }
          if (attempt >= checkFollowUp.attempts) {
            setCheckNotice({
              deviceId: device.id,
              tone: 'error',
              text: 'No result arrived; see the history for the outcome.',
            });
            return;
          }
          followCheck(device, since, attempt + 1);
        })
        .catch(() => followCheck(device, since, attempt + 1));
    }, checkFollowUp.intervalMs);
  }

  async function checkNow(device: Device) {
    setCheckingId(device.id);
    setCheckNotice(null);
    clearTimeout(followUp.current ?? undefined);
    const since = new Date().toISOString();
    try {
      const result = await api.requestDeviceCheck(device.id, device.organizationId);
      setCheckNotice({
        deviceId: device.id,
        tone: 'info',
        text: `Check requested from the ${result.data.collector} collector, waiting for the result…`,
      });
      followCheck(device, since);
    } catch (reason) {
      setCheckNotice({
        deviceId: device.id,
        tone: 'error',
        text: reason instanceof Error ? reason.message : 'Could not request a check.',
      });
    } finally {
      setCheckingId(null);
    }
  }
  const selectedAreaId = areas.some((area) => area.id === areaId) ? areaId : (areas[0]?.id ?? '');

  async function toggleHistory(device: Device) {
    if (historyId === device.id) {
      setHistoryId(null);
      return;
    }
    setHistoryId(device.id);
    setHistory([]);
    setHistoryError('');
    setLoadingHistory(true);
    try {
      setHistory(await loadHistory(device));
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : 'Could not load the check history.');
    } finally {
      setLoadingHistory(false);
    }
  }

  function startEditing(device: Device) {
    setEditingId(device.id);
    setAreaId(device.areaId);
    setName(device.name);
    setType(device.type);
    setAddress(device.address);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!network || !editingId || !selectedAreaId) return;
    setSaving(true);
    setError('');
    try {
      await api.updateDevice(editingId, {
        organizationId: network.organizationId,
        networkId: network.id,
        areaId: selectedAreaId,
        name: name.trim(),
        type,
        address: address.trim(),
      });
      setEditingId(null);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'A device with that address already exists in this network.'
          : reason instanceof Error
            ? reason.message
            : 'Could not update the device.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeDevice(device: Device) {
    if (!network || !window.confirm(`Remove “${device.name}” from this network? This cannot be undone.`))
      return;
    setDeletingId(device.id);
    setError('');
    try {
      await api.deleteDevice(device.id, network.organizationId);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove the device.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>Devices</h2>
          <p>{network ? `Inventory for ${network.name}.` : 'Select a network to manage its devices.'}</p>
        </div>
      </div>
      {!network && devices.length > 0 && (
        <p>Select a network in the dashboard filters to edit or remove its devices.</p>
      )}
      {network && !devices.length && !editingId && <p>No devices are registered in this network yet.</p>}
      {error && !editingId && <div className="data-error">{error}</div>}
      {devices.map((device) => (
        <Fragment key={device.id}>
          <div className={`network-management-row ${historyId === device.id ? 'expanded' : ''}`}>
            <div>
              <b>{device.name}</b>
              <small>
                {device.type} · {device.address} ·{' '}
                {areas.find((area) => area.id === device.areaId)?.name ?? 'Unknown area'}
              </small>
              <small className="device-status-line">
                <span className={`status-pill ${statusClass(device.status)}`}>
                  <i></i>
                  {device.status}
                </span>
                <span className="status-reason">{device.statusReason}</span>
              </small>
              <small
                className="device-last-seen"
                title={device.lastSeen ? formatTimestamp(device.lastSeen) : undefined}
              >
                {device.lastSeen ? `Last answered ${formatRelativeTime(device.lastSeen)}` : 'Never checked'}
                {device.status === 'Pending' && ' · waiting for the first check'}
              </small>
              {checkNotice?.deviceId === device.id && (
                <small className={`check-notice ${checkNotice.tone}`} role="status">
                  {checkNotice.text}
                </small>
              )}
            </div>
            <div className="management-actions">
              {canEdit && network?.id === device.networkId && !editingId && (
                <button
                  className="text-button"
                  disabled={checkingId === device.id}
                  onClick={() => void checkNow(device)}
                >
                  {checkingId === device.id ? 'Requesting…' : 'Check now'}
                </button>
              )}
              {!editingId && (
                <button
                  className="text-button"
                  aria-expanded={historyId === device.id}
                  aria-controls={`history-${device.id}`}
                  onClick={() => void toggleHistory(device)}
                >
                  {historyId === device.id ? 'Hide history ▴' : 'History ▾'}
                </button>
              )}
              {canEdit && network?.id === device.networkId && !editingId && (
                <button className="text-button" onClick={() => startEditing(device)}>
                  Edit
                </button>
              )}
              {canDelete && network?.id === device.networkId && !editingId && (
                <button
                  className="text-button danger-text"
                  disabled={deletingId === device.id}
                  onClick={() => void removeDevice(device)}
                >
                  {deletingId === device.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          </div>
          {historyId === device.id && !editingId && (
            <section
              className="observation-history"
              id={`history-${device.id}`}
              aria-label={`Check history for ${device.name}`}
            >
              <div className="observation-history-header">
                <b>Check history · {device.name}</b>
                <small>{device.address} · up to the 10 most recent checks, newest first</small>
              </div>
              {loadingHistory && <p>Loading check history…</p>}
              {historyError && <div className="data-error">{historyError}</div>}
              {!loadingHistory && !historyError && history.length === 0 && (
                <p>No checks have been recorded for this device yet.</p>
              )}
              {history.length > 0 && (
                <table className="observation-table">
                  <thead>
                    <tr>
                      <th scope="col">Checked at</th>
                      <th scope="col">Status</th>
                      <th scope="col">Latency</th>
                      <th scope="col">Load</th>
                      <th scope="col">Why</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((observation) => {
                      const reading = describeObservation(observation);
                      return (
                        <tr key={observation.id}>
                          <td className="mono" title={observation.collectedAt}>
                            {formatTimestamp(observation.collectedAt)}
                          </td>
                          <td>
                            <span className={`status-pill ${statusClass(reading.status)}`}>
                              <i></i>
                              {reading.label}
                            </span>
                          </td>
                          <td>{observation.latencyMs === null ? '—' : `${observation.latencyMs} ms`}</td>
                          <td>{observation.loadPercent === null ? '—' : `${observation.loadPercent}%`}</td>
                          <td>{reading.detail}</td>
                          <td>{observation.source}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </Fragment>
      ))}
      {editingId && network && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Device name
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Device type
            <select value={type} onChange={(event) => setType(event.target.value as DeviceType)}>
              {deviceTypes.map((deviceType) => (
                <option key={deviceType}>{deviceType}</option>
              ))}
            </select>
          </label>
          <label>
            Management address
            <input
              required
              maxLength={253}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          </label>
          <label>
            Area
            <select value={selectedAreaId} onChange={(event) => setAreaId(event.target.value)} required>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name} · {area.region}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving || !selectedAreaId}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
