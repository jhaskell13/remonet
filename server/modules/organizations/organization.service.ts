import { randomUUID } from 'node:crypto';
import type { Principal } from '../../auth.ts';
import { requirePermission } from '../../authorization.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
import {
  addMembership,
  createOrganization,
  createTeam,
  getOrganization,
  listOrganizationMembers,
  updateOrganization,
} from '../../store.ts';
import { recordAudit } from '../audit/audit.service.ts';

export type CreateOrganizationInput = { name: string; teamName?: string };
export type UpdateOrganizationInput = { name: string };

function cleanName(value: string, label: string) {
  const name = value.trim();
  if (!name) throw new AppError(400, `${label} is required`);
  return name;
}

/**
 * Any engineer may start a new organization; they become its first owner through a team created
 * alongside it. Ownership is never implicit: further owners are promoted explicitly by an owner.
 */
export function createOrganizationFor(principal: Principal, input: CreateOrganizationInput) {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required');
  const name = cleanName(input.name, 'Organization name');
  const teamName = cleanName(input.teamName ?? 'Owners', 'Team name');
  return db.transaction(() => {
    const organization = createOrganization({ id: randomUUID(), name });
    const team = createTeam({ id: randomUUID(), organizationId: organization.id, name: teamName });
    addMembership({ userId: principal.id, teamId: team.id, role: 'owner' });
    recordAudit(principal, {
      organizationId: organization.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: organization.id,
      details: { after: organization, team, owner: { userId: principal.id, teamId: team.id, role: 'owner' } },
    });
    return { ...organization, role: 'owner' as const, team };
  })();
}

export function updateOrganizationFor(principal: Principal, id: string, input: UpdateOrganizationInput) {
  requirePermission(principal, id, 'organization.update');
  const name = cleanName(input.name, 'Organization name');
  return db.transaction(() => {
    const before = getOrganization(id);
    const result = before && updateOrganization(id, name);
    if (!result) throw new AppError(404, 'Organization not found');
    recordAudit(principal, {
      organizationId: id,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: id,
      details: { before, after: result },
    });
    return result;
  })();
}

export function membersFor(principal: Principal, organizationId: string) {
  requirePermission(principal, organizationId, 'members.read');
  return listOrganizationMembers(organizationId);
}
