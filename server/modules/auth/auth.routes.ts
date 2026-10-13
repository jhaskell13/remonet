import type { FastifyInstance } from 'fastify';
import { requireAllowedOrigin, requirePrincipal } from '../../http/access.ts';
import { currentSession, login, logout, type LoginBody } from './auth.controller.ts';

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 256 },
    },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: loginSchema,
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
      preHandler: requireAllowedOrigin,
    },
    login,
  );

  app.get('/api/auth/me', { preHandler: requirePrincipal }, currentSession);
  app.post('/api/auth/logout', { preHandler: requireAllowedOrigin }, logout);
}
