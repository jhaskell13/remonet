import type { Principal } from '../auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
