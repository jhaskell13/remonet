import type { Principal } from '../../auth.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
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
