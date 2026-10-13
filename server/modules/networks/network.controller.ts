import type { FastifyRequest } from 'fastify';
import type { Principal } from '../../auth.ts';
import {
  areasFor,
  devicesFor,
  networksFor,
  organizationsFor,
  overviewFor,
  readinessStatus,
  teamsFor,
} from './network.service.ts';

export type NetworkQuery = { organizationId?: string; networkId?: string; areaId?: string };
export type TeamQuery = { organizationId?: string };
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
export function areas(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: areasFor(principal(request), request.query) };
}
export function devices(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: devicesFor(principal(request), request.query) };
}
export function overview(request: FastifyRequest<{ Querystring: NetworkQuery }>) {
  return { data: overviewFor(principal(request), request.query) };
}
