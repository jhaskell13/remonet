import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createOrganizationFor,
  membersFor,
  updateOrganizationFor,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from './organization.service.ts';

export type { CreateOrganizationInput, UpdateOrganizationInput } from './organization.service.ts';
export type OrganizationParams = { organizationId: string };

export function createOrganizationController(
  request: FastifyRequest<{ Body: CreateOrganizationInput }>,
  reply: FastifyReply,
) {
  reply.code(201);
  return { data: createOrganizationFor(request.principal!, request.body) };
}
export function updateOrganizationController(
  request: FastifyRequest<{ Params: OrganizationParams; Body: UpdateOrganizationInput }>,
) {
  return { data: updateOrganizationFor(request.principal!, request.params.organizationId, request.body) };
}
export function organizationMembersController(request: FastifyRequest<{ Params: OrganizationParams }>) {
  return { data: membersFor(request.principal!, request.params.organizationId) };
}
