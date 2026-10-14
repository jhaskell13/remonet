import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  acceptInvite,
  createInvite,
  inspectInvite,
  pendingInvitesFor,
  revokeInvite,
} from './invitation.service.ts';

export type InspectBody = { token: string };
export type CreateBody = {
  email: string;
  organizationId: string;
  teamId: string;
  role: 'admin' | 'operator' | 'viewer';
};
export type AcceptBody = { token: string; displayName?: string; password?: string };
export type OrganizationQuery = { organizationId: string };
export type InvitationParams = { invitationId: string };

export function inspectInvitationController(request: FastifyRequest<{ Body: InspectBody }>) {
  return { data: inspectInvite(request.body.token) };
}
export function createInvitationController(request: FastifyRequest<{ Body: CreateBody }>) {
  return createInvite(request.principal!, {
    ...request.body,
    email: request.body.email.trim().toLowerCase(),
  });
}
export function acceptInvitationController(
  request: FastifyRequest<{ Body: AcceptBody }>,
  reply: FastifyReply,
) {
  const result = acceptInvite(request.principal, request.body);
  if (result.cookie) reply.header('set-cookie', result.cookie);
  return { user: result.user, organizations: result.organizations };
}
export function listInvitationsController(request: FastifyRequest<{ Querystring: OrganizationQuery }>) {
  return { data: pendingInvitesFor(request.principal!, request.query.organizationId) };
}
export function revokeInvitationController(
  request: FastifyRequest<{ Params: InvitationParams; Querystring: OrganizationQuery }>,
) {
  return { data: revokeInvite(request.principal!, request.params.invitationId, request.query) };
}
