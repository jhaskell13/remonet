import { describe, expect, it } from 'vitest';
import { config } from '../../../server/config.ts';
import { allowedOrigin, expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, testPassword, users } from '../helpers/fixtures.ts';

const { demo } = fixtures;

describe('HTTP hardening', () => {
  const api = useTestApp();

  it('exposes liveness and readiness without authentication', async () => {
    const health = await api.anonymous.get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', service: 'remonet-api' });
    const ready = await api.anonymous.get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready' });
  });

  it('answers unknown routes with a JSON 404 carrying a request id', async () => {
    const response = await api.as(users.nsOwner).get('/api/nope');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found', requestId: expect.any(String) });
  });

  it('sends security headers and disables caching of API responses', async () => {
    const response = await api.as(users.nsOwner).get('/api/networks');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  describe('origin checks', () => {
    it('accepts the configured origin and echoes CORS headers for it', async () => {
      const response = await api
        .as(users.nsOwner)
        .get('/api/networks', { headers: { origin: allowedOrigin } });
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['vary']).toContain('Origin');
    });

    it('refuses any other origin before routing, even for authenticated mutations', async () => {
      const evil = 'https://evil.example';
      const read = await api.as(users.nsOwner).get('/api/networks', { headers: { origin: evil } });
      expectError(read, 403, 'Origin not allowed');
      const write = await api
        .as(users.nsOwner)
        .post(
          '/api/networks',
          { organizationId: demo.organizationId, name: 'CSRF', description: '' },
          { headers: { origin: evil } },
        );
      expectError(write, 403, 'Origin not allowed');
      const login = await api.anonymous.post(
        '/api/auth/login',
        { email: users.nsOwner.email, password: testPassword },
        { headers: { origin: evil } },
      );
      expectError(login, 403, 'Origin not allowed');
    });

    it('does not treat loopback aliases as allowed outside development', async () => {
      // config.ts only widens the origin check to localhost aliases when NODE_ENV=development.
      expect(config.nodeEnv).toBe('test');
      const response = await api.anonymous.get('/api/health', {
        headers: { origin: 'http://localhost:5173' },
      });
      expectError(response, 403, 'Origin not allowed');
    });

    it('answers CORS preflight requests with 204 for the allowed origin only', async () => {
      const ok = await api.anonymous.request('OPTIONS', '/api/networks', {
        headers: { origin: allowedOrigin },
      });
      expect(ok.status).toBe(204);
      expect(ok.headers['access-control-allow-methods']).toContain('DELETE');
      const refused = await api.anonymous.request('OPTIONS', '/api/networks', {
        headers: { origin: 'https://evil.example' },
      });
      expect(refused.status).toBe(403);
    });
  });

  it('rejects request bodies above the configured limit', async () => {
    const response = await api.as(users.nsOwner).post('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Big',
      description: 'x'.repeat(config.bodyLimitBytes + 1),
    });
    expectError(response, 413, 'Request body is too large');
  });

  it('throttles repeated login attempts per client', async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { response } = await api.login(users.nsOwner.email, 'wrong-password');
      lastStatus = response.status;
      expect(response.headers['x-ratelimit-limit']).toBe('8');
    }
    expect(lastStatus).toBe(401);
    const { response: throttled } = await api.login(users.nsOwner.email, testPassword);
    expectError(throttled, 429, 'Too many requests');
    expect(throttled.cookies).toHaveLength(0);
  });
});
