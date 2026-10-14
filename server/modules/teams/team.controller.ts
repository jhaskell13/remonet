import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  addMemberFor,
  changeRoleFor,
  createTeamFor,
  deleteTeamFor,
  removeMemberFor,
  updateTeamFor,
  type AddMemberInput,
  type ChangeRoleInput,
  type TeamInput,
} from './team.service.ts';

export type { AddMemberInput, ChangeRoleInput, TeamInput } from './team.service.ts';
export type TeamParams = { teamId: string };
export type MemberParams = { teamId: string; userId: string };
export type OrganizationQuery = { organizationId: string };

export function createTeamController(request: FastifyRequest<{ Body: TeamInput }>, reply: FastifyReply) {
  reply.code(201);
  return { data: createTeamFor(request.principal!, request.body) };
}
export function updateTeamController(request: FastifyRequest<{ Params: TeamParams; Body: TeamInput }>) {
  return { data: updateTeamFor(request.principal!, request.params.teamId, request.body) };
}
export function deleteTeamController(
  request: FastifyRequest<{ Params: TeamParams; Querystring: OrganizationQuery }>,
) {
  return { data: deleteTeamFor(request.principal!, request.params.teamId, request.query) };
}
export function addMemberController(
  request: FastifyRequest<{ Params: TeamParams; Body: AddMemberInput }>,
  reply: FastifyReply,
) {
  reply.code(201);
  return { data: addMemberFor(request.principal!, request.params.teamId, request.body) };
}
export function changeRoleController(
  request: FastifyRequest<{ Params: MemberParams; Body: ChangeRoleInput }>,
) {
  const { teamId, userId } = request.params;
  return { data: changeRoleFor(request.principal!, teamId, userId, request.body) };
}
export function removeMemberController(
  request: FastifyRequest<{ Params: MemberParams; Querystring: OrganizationQuery }>,
) {
  const { teamId, userId } = request.params;
  return { data: removeMemberFor(request.principal!, teamId, userId, request.query) };
}
