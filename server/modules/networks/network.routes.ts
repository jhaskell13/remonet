import type { FastifyInstance } from 'fastify';
import { requirePrincipal } from '../../http/access.ts';
import {
  areas,
  devices,
  health,
  networks,
  organizations,
  overview,
  readiness,
  teams,
  type NetworkQuery,
  type TeamQuery,
} from './network.controller.ts';

const networkQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    networkId: { type: 'string', minLength: 1, maxLength: 120 },
    areaId: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;
const teamQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { organizationId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;

export function registerNetworkRoutes(app: FastifyInstance) {
  app.get('/api/health', health);
  app.get('/api/ready', readiness);
  app.get('/api/organizations', { preHandler: requirePrincipal }, organizations);
  app.get<{ Querystring: TeamQuery }>(
    '/api/teams',
    { schema: { querystring: teamQuery }, preHandler: requirePrincipal },
    teams,
  );
  app.get<{ Querystring: NetworkQuery }>(
    '/api/networks',
    { schema: { querystring: networkQuery }, preHandler: requirePrincipal },
    networks,
  );
  app.get<{ Querystring: NetworkQuery }>(
    '/api/areas',
    { schema: { querystring: networkQuery }, preHandler: requirePrincipal },
    areas,
  );
  app.get<{ Querystring: NetworkQuery }>(
    '/api/devices',
    { schema: { querystring: networkQuery }, preHandler: requirePrincipal },
    devices,
  );
  app.get<{ Querystring: NetworkQuery }>(
    '/api/overview',
    { schema: { querystring: networkQuery }, preHandler: requirePrincipal },
    overview,
  );
}
