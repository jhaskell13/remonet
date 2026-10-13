import { useState, type FormEvent } from 'react';
import type { Area, DeviceType, Network } from '../../shared/network.ts';
import { api, ApiError } from '../api/client.ts';

const deviceTypes: DeviceType[] = ['Router', 'Switch', 'Firewall', 'Access point', 'Other'];

export function DeviceEnrollment({
  areas,
  network,
  canEnroll,
  onEnrolled,
}: {
  areas: Area[];
  network: Network | undefined;
  canEnroll: boolean;
  onEnrolled: () => void;
}) {
  const [areaId, setAreaId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceType>('Router');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedAreaId = areas.some((area) => area.id === areaId) ? areaId : (areas[0]?.id ?? '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!network || !selectedAreaId) return;
    setSaving(true);
    setError('');
    try {
      await api.enrollDevice({
        organizationId: network.organizationId,
        networkId: network.id,
        areaId: selectedAreaId,
        name: name.trim(),
        type,
        address: address.trim(),
      });
      setName('');
      setAddress('');
      onEnrolled();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'A device with that address is already registered in this network.'
          : reason instanceof Error
            ? reason.message
            : 'Could not enroll the device.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>Enroll a device</h2>
          <p>
            {network
              ? `Register hardware in ${network.name}. New devices stay Pending until monitoring reports a status.`
              : 'Select a network to enroll a device.'}
          </p>
        </div>
      </div>
      {network && !areas.length && <p>Add an area to this network before enrolling a device.</p>}
      {network && areas.length > 0 && canEnroll && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Device name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. North Campus Core Router"
            />
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
              placeholder="IP address or hostname"
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
            <button className="primary-button" type="submit" disabled={saving || !selectedAreaId}>
              {saving ? 'Enrolling…' : 'Enroll device'}
            </button>
          </div>
        </form>
      )}
      {network && areas.length > 0 && !canEnroll && (
        <p>You need operator access or higher to enroll devices in this organization.</p>
      )}
    </section>
  );
}
