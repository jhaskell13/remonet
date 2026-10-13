import { useState, type FormEvent } from 'react';
import type { Area, Device, DeviceType, Network } from '../../shared/network.ts';
import { api, ApiError } from '../api/client.ts';

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
  const selectedAreaId = areas.some((area) => area.id === areaId) ? areaId : (areas[0]?.id ?? '');

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
        <div className="network-management-row" key={device.id}>
          <div>
            <b>{device.name}</b>
            <small>
              {device.type} · {device.address} ·{' '}
              {areas.find((area) => area.id === device.areaId)?.name ?? 'Unknown area'} · {device.status}
            </small>
          </div>
          <div className="management-actions">
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
