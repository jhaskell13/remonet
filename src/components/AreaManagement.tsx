import { useState, type FormEvent } from 'react';
import type { Area, Device, Network } from '../../shared/network.ts';
import { api, ApiError } from '../api/client.ts';

type AreaManagementProps = {
  areas: Area[];
  devices: Device[];
  network: Network | undefined;
  canManage: boolean;
  onChanged: () => void;
};

export function AreaManagement({ areas, devices, network, canManage, onChanged }: AreaManagementProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startEditing(area?: Area) {
    setEditingId(area?.id ?? 'new');
    setName(area?.name ?? '');
    setRegion(area?.region ?? '');
    setError('');
  }

  async function removeArea(area: Area, deviceCount: number) {
    if (!network || deviceCount > 0) return;
    if (!window.confirm(`Delete area “${area.name}”? This cannot be undone.`)) return;
    setDeletingId(area.id);
    setError('');
    try {
      await api.deleteArea(area.id, { organizationId: network.organizationId, networkId: network.id });
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'This area still contains devices. Move or remove them before deleting the area.'
          : reason instanceof Error
            ? reason.message
            : 'Could not delete the area.',
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!network) return;
    setSaving(true);
    setError('');
    try {
      const input = {
        organizationId: network.organizationId,
        networkId: network.id,
        name: name.trim(),
        region: region.trim(),
      };
      if (editingId === 'new') await api.createArea(input);
      else if (editingId) await api.updateArea(editingId, input);
      setEditingId(null);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'An area with that name already exists in this network.'
          : reason instanceof Error
            ? reason.message
            : 'Could not save the area.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>Areas</h2>
          <p>{network ? `Locations within ${network.name}.` : 'Select a network to manage its areas.'}</p>
        </div>
        {network && canManage && !editingId && (
          <button className="primary-button" onClick={() => startEditing()}>
            <span>＋</span>Add area
          </button>
        )}
      </div>
      {network && !areas.length && !editingId && <p>No areas have been added to this network yet.</p>}
      {error && !editingId && <div className="data-error">{error}</div>}
      {areas.map((area) => (
        <div className="network-management-row" key={area.id}>
          <div>
            <b>{area.name}</b>
            <small>
              {area.region}
              {devices.some((device) => device.areaId === area.id) &&
                ` · ${devices.filter((device) => device.areaId === area.id).length} devices assigned`}
            </small>
          </div>
          {canManage && network && !editingId && (
            <div className="management-actions">
              <button className="text-button" onClick={() => startEditing(area)}>
                Edit
              </button>
              <button
                className="text-button danger-text"
                disabled={devices.some((device) => device.areaId === area.id) || deletingId === area.id}
                title={
                  devices.some((device) => device.areaId === area.id)
                    ? 'Move or remove assigned devices first'
                    : 'Delete empty area'
                }
                onClick={() =>
                  void removeArea(area, devices.filter((device) => device.areaId === area.id).length)
                }
              >
                {deletingId === area.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      ))}
      {editingId && network && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Area name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Region or location
            <input
              required
              maxLength={160}
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create area' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
