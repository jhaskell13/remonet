import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearedSessionCookie, createSession, destroySession, sessionCookie, signIn } from '../../auth.ts';

export type LoginBody = { email: string; password: string };

export async function login(request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) {
  const user = signIn(request.body.email, request.body.password);
  if (!user) return reply.code(401).send({ error: 'Email or password is incorrect', requestId: request.id });
  const session = createSession(user.id);
  reply.header('set-cookie', sessionCookie(session.token));
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    organizations: user.organizations,
  };
}

export function currentSession(request: FastifyRequest) {
  const principal = request.principal;
  return {
    user: { id: principal!.id, email: principal!.email, displayName: principal!.displayName },
    organizations: principal!.organizations,
  };
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  if (request.principal?.sessionToken) destroySession(request.principal.sessionToken);
  reply.header('set-cookie', clearedSessionCookie());
  return { ok: true };
}
