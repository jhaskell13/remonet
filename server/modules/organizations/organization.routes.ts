import type { FastifyInstance } from 'fastify';
import { requireEngineer } from '../../http/access.ts';
import {
  createOrganizationController,
  organizationMembersController,
  updateOrganizationController,
  type CreateOrganizationInput,
  type OrganizationParams,
  type UpdateOrganizationInput,
} from './organization.controller.ts';

const organizationParams = {
  type: 'object',
  required: ['organizationId'],
  additionalProperties: false,
  properties: { organizationId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const createOrganizationBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 },
    teamName: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;
const updateOrganizationBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, maxLength: 160 } },
} as const;

export function registerOrganizationRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateOrganizationInput }>(
    '/api/organizations',
    { schema: { body: createOrganizationBody }, preHandler: requireEngineer },
    createOrganizationController,
  );
  app.patch<{ Params: OrganizationParams; Body: UpdateOrganizationInput }>(
    '/api/organizations/:organizationId',
    { schema: { params: organizationParams, body: updateOrganizationBody }, preHandler: requireEngineer },
    updateOrganizationController,
  );
  app.get<{ Params: OrganizationParams }>(
    '/api/organizations/:organizationId/members',
    { schema: { params: organizationParams }, preHandler: requireEngineer },
    organizationMembersController,
  );
}
