import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { authenticate } from './auth.ts';
import { createScheduler, setActiveScheduler } from './collectors/runtime.ts';
import { config, isAllowedOrigin } from './config.ts';
import { closeDatabase, migrateDatabase } from './persistence/database.ts';
import { seedDatabase } from './persistence/seed.ts';
import { registerErrorHandling } from './http/error-handler.ts';
import './http/request-context.ts';
import { registerAuditRoutes } from './modules/audit/audit.routes.ts';
import { registerAuthRoutes } from './modules/auth/auth.routes.ts';
import { registerInvitationRoutes } from './modules/invitations/invitation.routes.ts';
import { registerMonitoringRoutes } from './modules/monitoring/monitoring.routes.ts';
import { registerNetworkRoutes } from './modules/networks/network.routes.ts';
import { registerOrganizationRoutes } from './modules/organizations/organization.routes.ts';
import { registerTeamRoutes } from './modules/teams/team.routes.ts';

export async function createApp() {
  migrateDatabase();
  seedDatabase();
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'development' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: false,
    disableRequestLogging: false,
    // Event streams hold their connection open; shutdown must not wait for dashboards to leave.
    forceCloseConnections: true,
  });

  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      return reply.code(403).send({ error: 'Origin not allowed', requestId: request.id });
    }
    if (origin) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('access-control-allow-headers', 'Authorization, Content-Type');
      reply.header('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('vary', 'Origin');
    }
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    request.principal = authenticate(request.cookies.remonet_session, request.headers.authorization);
    if (request.method === 'OPTIONS' && request.url.startsWith('/api/')) return reply.code(204).send();
  });
  // Collection runs inside the API process: it starts once the server is ready and is the first
  // thing stopped on shutdown so no check is recorded against a closing database.
  const scheduler = createScheduler(app.log);
  setActiveScheduler(scheduler);
  if (scheduler) app.addHook('onReady', async () => scheduler.start());
  app.addHook('onClose', async () => {
    await scheduler?.stop();
    setActiveScheduler(undefined);
    closeDatabase();
  });
  registerErrorHandling(app);
  registerAuthRoutes(app);
  registerInvitationRoutes(app);
  registerNetworkRoutes(app);
  registerMonitoringRoutes(app);
  registerOrganizationRoutes(app);
  registerTeamRoutes(app);
  registerAuditRoutes(app);
  return app;
}
