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
  type NetworkBody,
  createNetworkController,
  updateNetworkController,
  type AreaBody,
  createAreaController,
  updateAreaController,
} from './network.controller.ts';

const networkBody = {
  type: 'object',
  required: ['organizationId', 'name', 'description'],
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    description: { type: 'string', maxLength: 500 },
  },
} as const;

const networkQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    networkId: { type: 'string', minLength: 1, maxLength: 120 },
    areaId: { type: 'string', minLength: 1, maxLength: 120 },
  },
} as const;
const areaBody = {
  type: 'object',
  required: ['organizationId', 'networkId', 'name', 'region'],
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    networkId: { type: 'string', minLength: 1, maxLength: 120 },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    region: { type: 'string', minLength: 1, maxLength: 160 },
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
  app.post<{ Body: NetworkBody }>(
    '/api/networks',
    { schema: { body: networkBody }, preHandler: requirePrincipal },
    createNetworkController,
  );
  app.patch<{ Params: { networkId: string }; Body: NetworkBody }>(
    '/api/networks/:networkId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['networkId'],
          additionalProperties: false,
          properties: { networkId: { type: 'string', minLength: 1, maxLength: 120 } },
        },
        body: networkBody,
      },
      preHandler: requirePrincipal,
    },
    updateNetworkController,
  );
  app.post<{ Body: AreaBody }>(
    '/api/areas',
    { schema: { body: areaBody }, preHandler: requirePrincipal },
    createAreaController,
  );
  app.patch<{ Params: { areaId: string }; Body: AreaBody }>(
    '/api/areas/:areaId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['areaId'],
          additionalProperties: false,
          properties: { areaId: { type: 'string', minLength: 1, maxLength: 120 } },
        },
        body: areaBody,
      },
      preHandler: requirePrincipal,
    },
    updateAreaController,
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
