import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from './app-error.ts';

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: 'Not found', requestId: request.id }),
  );
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message, requestId: request.id });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'Invalid request', requestId: request.id });
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({ error: 'Too many requests', requestId: request.id });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      const message =
        error.statusCode === 413 ? 'Request body is too large' : 'Request could not be processed';
      return reply.code(error.statusCode).send({ error: message, requestId: request.id });
    }
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: 'Internal server error', requestId: request.id });
  });
}
