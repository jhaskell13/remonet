import type { FastifyInstance } from 'fastify';
import { requireAllowedOrigin, requireEngineer } from '../../http/access.ts';
import {
  acceptInvitationController,
  createInvitationController,
  inspectInvitationController,
  listInvitationsController,
  revokeInvitationController,
  type AcceptBody,
  type CreateBody,
  type InspectBody,
  type InvitationParams,
  type OrganizationQuery,
} from './invitation.controller.ts';

const organizationQuery = {
  type: 'object',
  required: ['organizationId'],
  additionalProperties: false,
  properties: { organizationId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;

const tokenBody = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: { token: { type: 'string', minLength: 1, maxLength: 256 } },
} as const;

export function registerInvitationRoutes(app: FastifyInstance) {
  app.post<{ Body: InspectBody }>(
    '/api/invitations/inspect',
    { schema: { body: tokenBody } },
    inspectInvitationController,
  );
  app.post<{ Body: CreateBody }>(
    '/api/invitations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'organizationId', 'teamId', 'role'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            organizationId: { type: 'string', minLength: 1, maxLength: 120 },
            teamId: { type: 'string', minLength: 1, maxLength: 120 },
            role: { type: 'string', enum: ['admin', 'operator', 'viewer'] },
          },
        },
      },
      preHandler: [requireAllowedOrigin, requireEngineer],
    },
    createInvitationController,
  );
  app.get<{ Querystring: OrganizationQuery }>(
    '/api/invitations',
    { schema: { querystring: organizationQuery }, preHandler: requireEngineer },
    listInvitationsController,
  );
  app.delete<{ Params: InvitationParams; Querystring: OrganizationQuery }>(
    '/api/invitations/:invitationId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['invitationId'],
          additionalProperties: false,
          properties: { invitationId: { type: 'string', minLength: 1, maxLength: 120 } },
        },
        querystring: organizationQuery,
      },
      preHandler: [requireAllowedOrigin, requireEngineer],
    },
    revokeInvitationController,
  );
  app.post<{ Body: AcceptBody }>(
    '/api/invitations/accept',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 256 },
            displayName: { type: 'string', maxLength: 100 },
            password: { type: 'string', maxLength: 256 },
          },
        },
      },
      preHandler: requireAllowedOrigin,
    },
    acceptInvitationController,
  );
}
