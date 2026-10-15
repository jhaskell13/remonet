import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Principal } from '../../auth.ts';
import { pollIntervalBounds, type DeviceType } from '../../../shared/network.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
import {
  createArea,
  createDevice,
  createNetwork,
  deleteAreaIfEmpty,
  deleteDevice,
  getArea,
  getDevice,
  getNetwork,
  updateArea,
  updateDevice,
  updateNetwork,
} from '../../persistence/repositories/network-repository.ts';
import { requirePermission } from '../../authorization.ts';
import { requestDeviceCheck } from '../../collectors/runtime.ts';
import { recordAudit } from '../audit/audit.service.ts';
import { publishMonitoringEvent, type MonitoringEvent } from '../monitoring/events.ts';
import {
  getOverview,
  listAreas,
  listDevices,
  listNetworks,
  listOrganizations,
  listTeams,
} from '../../store.ts';
import type { Scope } from '../../persistence/types.ts';

type InventoryChange = Extract<MonitoringEvent, { type: 'inventory' }>;
/** Tells connected dashboards that inventory changed; called after the change was committed. */
function announce(change: Omit<InventoryChange, 'type'>) {
  publishMonitoringEvent({ type: 'inventory', ...change });
}

export function readScope(
  principal: Principal,
  filters: { organizationId?: string; networkId?: string; areaId?: string },
): Scope {
  const organizationIds = principal.organizations.map((organization) => organization.id);
  if (filters.organizationId && !organizationIds.includes(filters.organizationId))
    throw new AppError(403, 'Organization access denied');
  return { organizationIds, ...filters };
}

export function readinessStatus() {
  db.prepare('SELECT 1').get();
  return { status: 'ready' };
}

export function organizationsFor(principal: Principal) {
  return listOrganizations(principal.organizations.map((organization) => organization.id)).map(
    (organization) => ({
      ...organization,
      role: principal.organizations.find((membership) => membership.id === organization.id)?.role ?? 'viewer',
    }),
  );
}

export function networksFor(
  principal: Principal,
  filters: { organizationId?: string; networkId?: string; areaId?: string },
) {
  return listNetworks(readScope(principal, filters));
}
export function areasFor(
  principal: Principal,
  filters: { organizationId?: string; networkId?: string; areaId?: string },
) {
  return listAreas(readScope(principal, filters));
}
export function devicesFor(
  principal: Principal,
  filters: { organizationId?: string; networkId?: string; areaId?: string },
) {
  return listDevices(readScope(principal, filters));
}
export function overviewFor(
  principal: Principal,
  filters: { organizationId?: string; networkId?: string; areaId?: string },
) {
  return getOverview(readScope(principal, filters));
}
export function teamsFor(principal: Principal, filters: { organizationId?: string }) {
  return listTeams({
    organizationIds: principal.organizations.map((organization) => organization.id),
    ...filters,
  });
}

export type NetworkInput = {
  organizationId: string;
  name: string;
  description: string;
  monitoringEnabled?: boolean | undefined;
  pollIntervalSeconds?: number | undefined;
};

function requireNetworkManager(principal: Principal, organizationId: string) {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required to manage networks');
  requirePermission(principal, organizationId, 'network.manage');
}

function cleanNetworkInput(input: NetworkInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Network name is required');
  if (
    input.pollIntervalSeconds !== undefined &&
    (!Number.isInteger(input.pollIntervalSeconds) ||
      input.pollIntervalSeconds < pollIntervalBounds.min ||
      input.pollIntervalSeconds > pollIntervalBounds.max)
  )
    throw new AppError(
      400,
      `Poll interval must be a whole number of seconds between ${pollIntervalBounds.min} and ${pollIntervalBounds.max}`,
    );
  return {
    organizationId: input.organizationId,
    name,
    description: input.description.trim(),
    monitoringEnabled: input.monitoringEnabled,
    pollIntervalSeconds: input.pollIntervalSeconds,
  };
}

export function createNetworkFor(principal: Principal, input: NetworkInput) {
  requireNetworkManager(principal, input.organizationId);
  const cleanInput = cleanNetworkInput(input);
  try {
    const network = db.transaction(() => {
      const created = createNetwork({ id: randomUUID(), ...cleanInput });
      recordAudit(principal, {
        organizationId: created.organizationId,
        action: 'network.created',
        entityType: 'network',
        entityId: created.id,
        details: { after: created },
      });
      return created;
    })();
    announce({
      organizationId: network.organizationId,
      networkId: network.id,
      entityType: 'network',
      entityId: network.id,
      action: 'created',
    });
    return network;
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, 'A network with this name already exists');
    throw error;
  }
}

export function updateNetworkFor(principal: Principal, id: string, input: NetworkInput) {
  requireNetworkManager(principal, input.organizationId);
  const cleanInput = cleanNetworkInput(input);
  try {
    const network = db.transaction(() => {
      const before = getNetwork(id, [cleanInput.organizationId]);
      const result = before && updateNetwork(id, [cleanInput.organizationId], cleanInput);
      if (!result) throw new AppError(404, 'Network not found');
      recordAudit(principal, {
        organizationId: result.organizationId,
        action: 'network.updated',
        entityType: 'network',
        entityId: result.id,
        details: { before, after: result },
      });
      return result;
    })();
    announce({
      organizationId: network.organizationId,
      networkId: network.id,
      entityType: 'network',
      entityId: network.id,
      action: 'updated',
    });
    return network;
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, 'A network with this name already exists');
    throw error;
  }
}

function isUniqueConstraint(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export type AreaInput = { organizationId: string; networkId: string; name: string; region: string };

function cleanAreaInput(input: AreaInput) {
  const name = input.name.trim();
  const region = input.region.trim();
  if (!name) throw new AppError(400, 'Area name is required');
  if (!region) throw new AppError(400, 'Area region is required');
  return { ...input, name, region };
}

function requireAreaNetwork(principal: Principal, organizationId: string, networkId: string) {
  requireNetworkManager(principal, organizationId);
  if (!getNetwork(networkId, [organizationId])) throw new AppError(404, 'Network not found');
}

export function createAreaFor(principal: Principal, input: AreaInput) {
  const cleanInput = cleanAreaInput(input);
  requireAreaNetwork(principal, cleanInput.organizationId, cleanInput.networkId);
  try {
    const area = db.transaction(() => {
      const created = createArea({ id: randomUUID(), ...cleanInput });
      recordAudit(principal, {
        organizationId: created.organizationId,
        action: 'area.created',
        entityType: 'area',
        entityId: created.id,
        details: { after: created },
      });
      return created;
    })();
    announce({
      organizationId: area.organizationId,
      networkId: area.networkId,
      entityType: 'area',
      entityId: area.id,
      action: 'created',
    });
    return area;
  } catch (error) {
    if (isUniqueConstraint(error))
      throw new AppError(409, 'An area with this name already exists in the network');
    throw error;
  }
}

export function updateAreaFor(principal: Principal, id: string, input: AreaInput) {
  const cleanInput = cleanAreaInput(input);
  requireAreaNetwork(principal, cleanInput.organizationId, cleanInput.networkId);
  try {
    const area = db.transaction(() => {
      const before = getArea(id, cleanInput.organizationId, cleanInput.networkId);
      const result =
        before &&
        updateArea(id, cleanInput.organizationId, cleanInput.networkId, cleanInput.name, cleanInput.region);
      if (!result) throw new AppError(404, 'Area not found');
      recordAudit(principal, {
        organizationId: result.organizationId,
        action: 'area.updated',
        entityType: 'area',
        entityId: result.id,
        details: { before, after: result },
      });
      return result;
    })();
    announce({
      organizationId: area.organizationId,
      networkId: area.networkId,
      entityType: 'area',
      entityId: area.id,
      action: 'updated',
    });
    return area;
  } catch (error) {
    if (isUniqueConstraint(error))
      throw new AppError(409, 'An area with this name already exists in the network');
    throw error;
  }
}
export function deleteAreaFor(
  principal: Principal,
  id: string,
  input: { organizationId: string; networkId: string },
) {
  requireAreaNetwork(principal, input.organizationId, input.networkId);
  const before = db.transaction(() => {
    const area = getArea(id, input.organizationId, input.networkId);
    if (!area) throw new AppError(404, 'Area not found');
    if (!deleteAreaIfEmpty(id, input.organizationId, input.networkId))
      throw new AppError(409, 'Move or remove the devices in this area before deleting it');
    recordAudit(principal, {
      organizationId: area.organizationId,
      action: 'area.deleted',
      entityType: 'area',
      entityId: area.id,
      details: { before: area },
    });
    return area;
  })();
  announce({
    organizationId: before.organizationId,
    networkId: before.networkId,
    entityType: 'area',
    entityId: before.id,
    action: 'deleted',
  });
  return { ok: true as const };
}

export type EnrollDeviceInput = {
  organizationId: string;
  networkId: string;
  areaId: string;
  name: string;
  type: DeviceType;
  address: string;
};

function requireDeviceOperator(principal: Principal, organizationId: string) {
  if (principal.serviceToken) throw new AppError(403, 'Organization access denied');
  requirePermission(principal, organizationId, 'device.enroll');
}

function cleanDeviceInput(input: EnrollDeviceInput) {
  const name = input.name.trim();
  const address = input.address.trim();
  if (!name) throw new AppError(400, 'Device name is required');
  const hostname = address.replace(/\.$/, '');
  const labels = hostname.split('.');
  const validHostname =
    hostname.length > 0 &&
    hostname.length <= 253 &&
    labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) &&
    // An all-numeric top-level label is not a hostname; it is almost always a mistyped IP address.
    !/^\d+$/.test(labels[labels.length - 1] ?? '');
  if (!address || address.length > 253 || (isIP(address) === 0 && !validHostname))
    throw new AppError(400, 'Enter a valid IP address or hostname');
  return { ...input, name, address };
}

function requireDeviceArea(input: EnrollDeviceInput) {
  const area = getArea(input.areaId, input.organizationId, input.networkId);
  if (!area) throw new AppError(404, 'Area not found in this network');
}

export function enrollDeviceFor(principal: Principal, input: EnrollDeviceInput) {
  requireDeviceOperator(principal, input.organizationId);
  const cleanInput = cleanDeviceInput(input);
  requireDeviceArea(cleanInput);

  try {
    const device = db.transaction(() => {
      const created = createDevice({ id: randomUUID(), ...cleanInput });
      recordAudit(principal, {
        organizationId: created.organizationId,
        action: 'device.enrolled',
        entityType: 'device',
        entityId: created.id,
        details: { after: created },
      });
      return created;
    })();
    announce({
      organizationId: device.organizationId,
      networkId: device.networkId,
      entityType: 'device',
      entityId: device.id,
      action: 'created',
    });
    // A new device should not wait for its network's next cycle to leave Pending.
    requestDeviceCheck(device);
    return device;
  } catch (error) {
    if (isUniqueConstraint(error))
      throw new AppError(409, 'A device with this address already exists in the network');
    throw error;
  }
}

export function updateDeviceFor(principal: Principal, id: string, input: EnrollDeviceInput) {
  requireDeviceOperator(principal, input.organizationId);
  const cleanInput = cleanDeviceInput(input);
  requireDeviceArea(cleanInput);
  try {
    const { device, readdressed } = db.transaction(() => {
      const before = getDevice(id, cleanInput.organizationId);
      const result = before && updateDevice({ id, ...cleanInput });
      if (!result) throw new AppError(404, 'Device not found');
      recordAudit(principal, {
        organizationId: result.organizationId,
        action: 'device.updated',
        entityType: 'device',
        entityId: result.id,
        details: { before, after: result },
      });
      return { device: result, readdressed: before.address.toLowerCase() !== result.address.toLowerCase() };
    })();
    announce({
      organizationId: device.organizationId,
      networkId: device.networkId,
      entityType: 'device',
      entityId: device.id,
      action: 'updated',
    });
    // A re-addressed device is Pending again; check the new address right away.
    if (readdressed) requestDeviceCheck(device);
    return device;
  } catch (error) {
    if (isUniqueConstraint(error))
      throw new AppError(409, 'A device with this address already exists in the network');
    throw error;
  }
}

export function deleteDeviceFor(principal: Principal, id: string, input: { organizationId: string }) {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required to manage networks');
  requirePermission(principal, input.organizationId, 'device.delete');
  const before = db.transaction(() => {
    const device = getDevice(id, input.organizationId);
    if (!device || !deleteDevice(id, input.organizationId)) throw new AppError(404, 'Device not found');
    recordAudit(principal, {
      organizationId: device.organizationId,
      action: 'device.deleted',
      entityType: 'device',
      entityId: device.id,
      details: { before: device },
    });
    return device;
  })();
  announce({
    organizationId: before.organizationId,
    networkId: before.networkId,
    entityType: 'device',
    entityId: before.id,
    action: 'deleted',
  });
  return { ok: true as const };
}
