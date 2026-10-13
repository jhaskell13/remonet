import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Principal } from '../../auth.ts';
import {
  areasFor,
  devicesFor,
  networksFor,
  organizationsFor,
  overviewFor,
  createNetworkFor,
  updateNetworkFor,
  createAreaFor,
  updateAreaFor,
  enrollDeviceFor,
  updateDeviceFor,
  deleteDeviceFor,
  deleteAreaFor,
  type EnrollDeviceInput,
  readinessStatus,
  teamsFor,
} from './network.service.ts';

export type { EnrollDeviceInput } from './network.service.ts';

export type NetworkQuery = { organizationId?: string; networkId?: string; areaId?: string };
export type TeamQuery = { organizationId?: string };
export type NetworkBody = { organizationId: string; name: string; description: string };
export type AreaBody = { organizationId: string; networkId: string; name: string; region: string };
export type DeviceBody = {
  organizationId: string;
  networkId: string;
  areaId: string;
  name: string;
  type: EnrollDeviceInput['type'];
  address: string;
};
const principal = (request: FastifyRequest): Principal => request.principal!;

export function health() {
  return { status: 'ok', service: 'remonet-api' };
}
export function readiness() {
  return readinessStatus();
}
export function organizations(request: FastifyRequest) {
  return { data: organizationsFor(principal(request)) };
}
export function teams(request: FastifyRequest<{ Querystring: TeamQuery }>) {
  return { data: teamsFor(principal(request), request.query) };
}
export function networks(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: networksFor(principal(request), request.query) };
}
export function createNetworkController(request: FastifyRequest<{ Body: NetworkBody }>, reply: FastifyReply) {
  reply.code(201);
  return { data: createNetworkFor(principal(request), request.body) };
}
export function updateNetworkController(
  request: FastifyRequest<{ Params: { networkId: string }; Body: NetworkBody }>,
) {
  return { data: updateNetworkFor(principal(request), request.params.networkId, request.body) };
}
export function createAreaController(request: FastifyRequest<{ Body: AreaBody }>, reply: FastifyReply) {
  reply.code(201);
  return { data: createAreaFor(principal(request), request.body) };
}
export function updateAreaController(
  request: FastifyRequest<{ Params: { areaId: string }; Body: AreaBody }>,
) {
  return { data: updateAreaFor(principal(request), request.params.areaId, request.body) };
}
export function deleteAreaController(
  request: FastifyRequest<{
    Params: { areaId: string };
    Querystring: { organizationId: string; networkId: string };
  }>,
) {
  return { data: deleteAreaFor(principal(request), request.params.areaId, request.query) };
}
export function enrollDeviceController(
  request: FastifyRequest<{ Body: EnrollDeviceInput }>,
  reply: FastifyReply,
) {
  reply.code(201);
  return { data: enrollDeviceFor(principal(request), request.body) };
}
export function updateDeviceController(
  request: FastifyRequest<{ Params: { deviceId: string }; Body: DeviceBody }>,
) {
  return { data: updateDeviceFor(principal(request), request.params.deviceId, request.body) };
}
export function deleteDeviceController(
  request: FastifyRequest<{ Params: { deviceId: string }; Querystring: { organizationId: string } }>,
) {
  return { data: deleteDeviceFor(principal(request), request.params.deviceId, request.query) };
}
export function areas(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: areasFor(principal(request), request.query) };
}
export function devices(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: devicesFor(principal(request), request.query) };
}
export function overview(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: overviewFor(principal(request), request.query) };
}
