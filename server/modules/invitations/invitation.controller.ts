import type { FastifyReply, FastifyRequest } from 'fastify';
import { acceptInvite, createInvite, inspectInvite } from './invitation.service.ts';

export type InspectBody = { token: string };
export type CreateBody = {
  email: string;
  organizationId: string;
  teamId: string;
  role: 'admin' | 'operator' | 'viewer';
};
export type AcceptBody = { token: string; displayName?: string; password?: string };

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
