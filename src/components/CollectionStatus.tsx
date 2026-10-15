import { useEffect, useState } from 'react';
import type { CollectionStatus as CollectionStatusData } from '../../shared/network.ts';
import { api } from '../api/client.ts';
import { formatRelativeTime, formatTimestamp } from '../lib/time.ts';

/**
 * Collection state per network for administrators: which collector runs, what it is doing now, and
 * how the last cycle went. Reloads whenever the dashboard refreshes its data.
 */
export function CollectionStatus({
  organizationId,
  canManage,
  dataVersion,
}: {
  organizationId: string;
  canManage: boolean;
  dataVersion: number;
}) {
  const [status, setStatus] = useState<CollectionStatusData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!organizationId || !canManage) return;
    let current = true;
    api
      .monitoringStatus({ organizationId })
      .then((result) => {
        if (current) {
          setStatus(result.data);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : 'Could not load collection state.');
      });
    return () => {
      current = false;
    };
  }, [organizationId, canManage, dataVersion]);
  if (!organizationId || !canManage) return null;
  return (
    <section className="panel settings-panel network-management" aria-label="Collection">
      <div className="panel-header">
        <div>
          <h2>Collection</h2>
          <p>
            {status
              ? status.collector === 'off'
                ? 'No collector is running; device data only changes through manual checks.'
                : `${status.collector} collector · ${status.running ? 'running' : 'stopped'} · ${status.inFlight} checks in flight`
              : 'Loading collection state…'}
          </p>
        </div>
      </div>
      {error && <div className="data-error">{error}</div>}
      {status && status.networks.length === 0 && !error && <p>No networks are scheduled for collection.</p>}
      {status && status.networks.length > 0 && (
        <table className="observation-table">
          <thead>
            <tr>
              <th scope="col">Network</th>
              <th scope="col">Collection</th>
              <th scope="col">Next cycle</th>
              <th scope="col">Last cycle</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {status.networks.map((network) => (
              <tr key={network.networkId}>
                <td>{network.name}</td>
                <td>
                  {network.enabled
                    ? `Every ${network.pollIntervalSeconds} s${network.running ? ' · running' : ''}`
                    : 'Paused'}
                </td>
                <td title={network.nextRunAt ?? undefined}>
                  {network.running
                    ? 'In progress'
                    : network.nextRunAt
                      ? formatTimestamp(network.nextRunAt)
                      : '—'}
                </td>
                <td title={network.lastCycle?.completedAt}>
                  {network.lastCycle ? formatRelativeTime(network.lastCycle.completedAt) : 'Not yet'}
                </td>
                <td>
                  {network.lastError ? (
                    <span className="danger-text">{network.lastError}</span>
                  ) : network.lastCycle ? (
                    `${network.lastCycle.success} ok · ${network.lastCycle.timeout} timed out · ${network.lastCycle.error} failed · ${network.lastCycle.durationMs} ms`
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
