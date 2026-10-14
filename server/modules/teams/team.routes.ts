import type { FastifyInstance } from 'fastify';
import { accessRoles } from '../../../shared/permissions.ts';
import { requireEngineer } from '../../http/access.ts';
import {
  addMemberController,
  changeRoleController,
  createTeamController,
  deleteTeamController,
  removeMemberController,
  updateTeamController,
  type AddMemberInput,
  type ChangeRoleInput,
  type MemberParams,
  type OrganizationQuery,
  type TeamInput,
  type TeamParams,
} from './team.controller.ts';

const id = { type: 'string', minLength: 1, maxLength: 120 } as const;
const teamParams = {
  type: 'object',
  required: ['teamId'],
  additionalProperties: false,
  properties: { teamId: id },
} as const;
const memberParams = {
  type: 'object',
  required: ['teamId', 'userId'],
  additionalProperties: false,
  properties: { teamId: id, userId: id },
} as const;
const organizationQuery = {
  type: 'object',
  required: ['organizationId'],
  additionalProperties: false,
  properties: { organizationId: id },
} as const;
const teamBody = {
  type: 'object',
  required: ['organizationId', 'name'],
  additionalProperties: false,
  properties: { organizationId: id, name: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const addMemberBody = {
  type: 'object',
  required: ['organizationId', 'userId', 'role'],
  additionalProperties: false,
  properties: { organizationId: id, userId: id, role: { type: 'string', enum: accessRoles } },
} as const;
const changeRoleBody = {
  type: 'object',
  required: ['organizationId', 'role'],
  additionalProperties: false,
  properties: { organizationId: id, role: { type: 'string', enum: accessRoles } },
} as const;

export function registerTeamRoutes(app: FastifyInstance) {
  app.post<{ Body: TeamInput }>(
    '/api/teams',
    { schema: { body: teamBody }, preHandler: requireEngineer },
    createTeamController,
  );
  app.patch<{ Params: TeamParams; Body: TeamInput }>(
    '/api/teams/:teamId',
    { schema: { params: teamParams, body: teamBody }, preHandler: requireEngineer },
    updateTeamController,
  );
  app.delete<{ Params: TeamParams; Querystring: OrganizationQuery }>(
    '/api/teams/:teamId',
    { schema: { params: teamParams, querystring: organizationQuery }, preHandler: requireEngineer },
    deleteTeamController,
  );
  app.post<{ Params: TeamParams; Body: AddMemberInput }>(
    '/api/teams/:teamId/members',
    { schema: { params: teamParams, body: addMemberBody }, preHandler: requireEngineer },
    addMemberController,
  );
  app.patch<{ Params: MemberParams; Body: ChangeRoleInput }>(
    '/api/teams/:teamId/members/:userId',
    { schema: { params: memberParams, body: changeRoleBody }, preHandler: requireEngineer },
    changeRoleController,
  );
  app.delete<{ Params: MemberParams; Querystring: OrganizationQuery }>(
    '/api/teams/:teamId/members/:userId',
    { schema: { params: memberParams, querystring: organizationQuery }, preHandler: requireEngineer },
    removeMemberController,
  );
}
