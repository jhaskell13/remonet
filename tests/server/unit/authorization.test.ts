import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../server/auth.ts';
import { organizationRole, requirePermission } from '../../../server/authorization.ts';
import { AppError } from '../../../server/http/app-error.ts';
import { requireAllowedOrigin, requireEngineer, requirePrincipal } from '../../../server/http/access.ts';
import { permissionMatrix, type Permission } from '../../../shared/permissions.ts';

const engineer: Principal = {
  id: 'user-1',
  email: 'one@remonet.test',
  displayName: 'One',
  organizations: [
    { id: 'org-a', name: 'A', role: 'admin' },
    { id: 'org-b', name: 'B', role: 'viewer' },
  ],
  sessionToken: 'token',
};
const service: Principal = {
  id: 'service-token',
  email: '',
  displayName: 'API integration',
  organizations: [{ id: 'org-a', name: 'A', role: 'viewer' }],
  serviceToken: true,
};

function refusal(fn: () => unknown) {
  try {
    fn();
    return undefined;
  } catch (error) {
    const failure = error as AppError;
    return { status: failure.statusCode, message: failure.message };
  }
}

describe('requirePermission', () => {
  it('returns the role when the matrix allows the permission', () => {
    expect(requirePermission(engineer, 'org-a', 'network.manage')).toBe('admin');
    expect(requirePermission(engineer, 'org-b', 'inventory.read')).toBe('viewer');
    expect(organizationRole(engineer, 'org-b')).toBe('viewer');
    expect(organizationRole(engineer, 'org-zzz')).toBeUndefined();
  });

  it('refuses non-members and unknown organizations with the same message', () => {
    expect(refusal(() => requirePermission(engineer, 'org-c', 'inventory.read'))).toEqual({
      status: 403,
      message: 'Organization access denied',
    });
    expect(refusal(() => requirePermission(engineer, 'org-missing', 'inventory.read'))).toEqual({
      status: 403,
      message: 'Organization access denied',
    });
  });

  it('names the required level when the role is insufficient', () => {
    expect(refusal(() => requirePermission(engineer, 'org-b', 'device.enroll'))).toEqual({
      status: 403,
      message: 'Organization operator access required',
    });
    expect(refusal(() => requirePermission(engineer, 'org-b', 'network.manage'))).toEqual({
      status: 403,
      message: 'Organization admin access required',
    });
    expect(refusal(() => requirePermission(engineer, 'org-a', 'organization.update'))).toEqual({
      status: 403,
      message: 'Organization owner access required',
    });
    expect(refusal(() => requirePermission(engineer, 'org-a', 'team.delete'))).toEqual({
      status: 403,
      message: 'Organization owner access required',
    });
  });

  it('limits the integration token to inventory and team reads regardless of its organizations', () => {
    expect(requirePermission(service, 'org-a', 'inventory.read')).toBe('viewer');
    expect(requirePermission(service, 'org-a', 'teams.read')).toBe('viewer');
    for (const permission of Object.keys(permissionMatrix) as Permission[]) {
      if (permission === 'inventory.read' || permission === 'teams.read') continue;
      expect(
        refusal(() => requirePermission(service, 'org-a', permission)),
        permission,
      ).toEqual({ status: 403, message: 'Engineer account required' });
    }
    expect(refusal(() => requirePermission(service, 'org-b', 'inventory.read'))).toEqual({
      status: 403,
      message: 'Organization access denied',
    });
  });
});

describe('route guards', () => {
  function reply() {
    const sent: { code?: number; body?: unknown } = {};
    const stub = {
      code: vi.fn((code: number) => {
        sent.code = code;
        return stub;
      }),
      send: vi.fn((body: unknown) => {
        sent.body = body;
        return stub;
      }),
    };
    return { stub: stub as unknown as FastifyReply, sent };
  }
  const request = (overrides: Partial<FastifyRequest>) =>
    ({ headers: {}, principal: null, ...overrides }) as FastifyRequest;

  it('requirePrincipal refuses anonymous requests only', async () => {
    const anonymous = reply();
    await requirePrincipal(request({}), anonymous.stub);
    expect(anonymous.sent).toEqual({ code: 401, body: { error: 'Unauthorized' } });
    const authenticated = reply();
    await requirePrincipal(request({ principal: service }), authenticated.stub);
    expect(authenticated.sent).toEqual({});
  });

  it('requireEngineer refuses anonymous requests and the integration token', async () => {
    for (const principal of [null, service]) {
      const { stub, sent } = reply();
      await requireEngineer(request({ principal }), stub);
      expect(sent).toEqual({ code: 401, body: { error: 'Sign in with an engineer account' } });
    }
    const { stub, sent } = reply();
    await requireEngineer(request({ principal: engineer }), stub);
    expect(sent).toEqual({});
  });

  it('requireAllowedOrigin refuses foreign origins even if the global hook were bypassed', async () => {
    const foreign = reply();
    await requireAllowedOrigin(request({ headers: { origin: 'https://evil.example' } }), foreign.stub);
    expect(foreign.sent).toEqual({ code: 403, body: { error: 'Origin not allowed' } });
    const allowed = reply();
    await requireAllowedOrigin(request({ headers: { origin: 'http://127.0.0.1:5173' } }), allowed.stub);
    expect(allowed.sent).toEqual({});
    const absent = reply();
    await requireAllowedOrigin(request({}), absent.stub);
    expect(absent.sent).toEqual({});
  });
});
