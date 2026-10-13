import { randomUUID } from 'node:crypto';
import type { Principal } from '../../auth.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
import {
  createArea,
  createNetwork,
  getNetwork,
  updateArea,
  updateNetwork,
} from '../../persistence/repositories/network-repository.ts';
import { canManageOrganization } from '../../persistence/repositories/team-repository.ts';
import {
  getOverview,
  listAreas,
  listDevices,
  listNetworks,
  listOrganizations,
  listTeams,
} from '../../store.ts';
import type { Scope } from '../../persistence/types.ts';

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

export type NetworkInput = { organizationId: string; name: string; description: string };

function requireNetworkManager(principal: Principal, organizationId: string) {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required to manage networks');
  if (!principal.organizations.some((organization) => organization.id === organizationId))
    throw new AppError(403, 'Organization access denied');
  if (!canManageOrganization(principal.id, organizationId))
    throw new AppError(403, 'Organization admin access required');
}

function cleanNetworkInput(input: NetworkInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Network name is required');
  return {
    organizationId: input.organizationId,
    name,
    description: input.description.trim(),
  };
}

export function createNetworkFor(principal: Principal, input: NetworkInput) {
  requireNetworkManager(principal, input.organizationId);
  try {
    return createNetwork({ id: randomUUID(), ...cleanNetworkInput(input) });
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, 'A network with this name already exists');
    throw error;
  }
}

export function updateNetworkFor(principal: Principal, id: string, input: NetworkInput) {
  requireNetworkManager(principal, input.organizationId);
  try {
    const result = updateNetwork(id, [input.organizationId], cleanNetworkInput(input));
    if (!result) throw new AppError(404, 'Network not found');
    return result;
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
    return createArea({ id: randomUUID(), ...cleanInput });
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
    const result = updateArea(
      id,
      cleanInput.organizationId,
      cleanInput.networkId,
      cleanInput.name,
      cleanInput.region,
    );
    if (!result) throw new AppError(404, 'Area not found');
    return result;
  } catch (error) {
    if (isUniqueConstraint(error))
      throw new AppError(409, 'An area with this name already exists in the network');
    throw error;
  }
}
