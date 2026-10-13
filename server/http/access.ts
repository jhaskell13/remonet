import type { FastifyReply, FastifyRequest } from 'fastify';
import { isAllowedOrigin } from '../config.ts';

export async function requirePrincipal(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal) return reply.code(401).send({ error: 'Unauthorized' });
}

export async function requireEngineer(request: FastifyRequest, reply: FastifyReply) {
  if (!request.principal || request.principal.serviceToken) {
    return reply.code(401).send({ error: 'Sign in with an engineer account' });
  }
}

export async function requireAllowedOrigin(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) return reply.code(403).send({ error: 'Origin not allowed' });
}
