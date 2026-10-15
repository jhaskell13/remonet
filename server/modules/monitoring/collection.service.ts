import type { Principal } from '../../auth.ts';
import { hasPermission } from '../../../shared/permissions.ts';
import { requirePermission } from '../../authorization.ts';
import { getActiveScheduler, requestDeviceCheck } from '../../collectors/runtime.ts';
import type { CollectionStatus } from '../../../shared/network.ts';
import { AppError } from '../../http/app-error.ts';
import { getDevice } from '../../persistence/repositories/network-repository.ts';

export type { CollectionStatus };

/** Collection state for the networks the caller administers, optionally limited to one organization. */
export function collectionStatusFor(
  principal: Principal,
  filters: { organizationId?: string | undefined },
): CollectionStatus {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required to read collection state');
  if (filters.organizationId) requirePermission(principal, filters.organizationId, 'network.manage');
  const manageable = new Set(
    principal.organizations
      .filter((organization) => hasPermission(organization.role, 'network.manage'))
      .map((organization) => organization.id),
  );
  const scheduler = getActiveScheduler();
  const state = scheduler?.getState();
  return {
    collector: scheduler ? state!.source : 'off',
    running: state?.running ?? false,
    inFlight: state?.inFlight ?? 0,
    networks: (state?.networks ?? []).filter(
      (network) =>
        manageable.has(network.organizationId) &&
        (!filters.organizationId || network.organizationId === filters.organizationId),
    ),
  };
}

/** Asks for a check of one device right now. Operators and above, like enrollment itself. */
export function requestCheckFor(principal: Principal, deviceId: string, input: { organizationId: string }) {
  if (principal.serviceToken) throw new AppError(403, 'Organization access denied');
  requirePermission(principal, input.organizationId, 'device.enroll');
  const device = getDevice(deviceId, input.organizationId);
  if (!device) throw new AppError(404, 'Device not found');
  if (!requestDeviceCheck(device)) throw new AppError(409, 'No collector is running');
  return {
    requested: true as const,
    deviceId: device.id,
    collector: getActiveScheduler()!.getState().source,
  };
}
