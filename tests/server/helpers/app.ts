import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll } from 'vitest';
import { createApp } from '../../../server/app.ts';
import { createSession } from '../../../server/auth.ts';
import { seedTestData, type TestUser } from './fixtures.ts';
import { useTransactionPerTest } from './transaction.ts';

export const allowedOrigin = 'http://127.0.0.1:5173';
export const serviceToken = process.env.REMONET_API_TOKEN!;

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  headers: LightMyRequestResponse['headers'];
  cookies: LightMyRequestResponse['cookies'];
  raw: LightMyRequestResponse;
};

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;
type RequestOptions = {
  body?: Json;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
};

/** A minimal HTTP client over `app.inject()` bound to one identity (or none). */
export class ApiClient {
  constructor(
    private readonly app: FastifyInstance,
    private readonly defaults: Pick<RequestOptions, 'headers' | 'cookies'> = {},
  ) {}

  get<T = unknown>(url: string, options: RequestOptions = {}) {
    return this.request<T>('GET', url, options);
  }
  post<T = unknown>(url: string, body?: Json, options: RequestOptions = {}) {
    return this.request<T>('POST', url, { ...options, ...(body === undefined ? {} : { body }) });
  }
  patch<T = unknown>(url: string, body?: Json, options: RequestOptions = {}) {
    return this.request<T>('PATCH', url, { ...options, ...(body === undefined ? {} : { body }) });
  }
  delete<T = unknown>(url: string, options: RequestOptions = {}) {
    return this.request<T>('DELETE', url, options);
  }

  async request<T = unknown>(
    method: NonNullable<InjectOptions['method']>,
    url: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const query = Object.fromEntries(
      Object.entries(options.query ?? {})
        .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    const inject: InjectOptions = {
      method,
      url,
      query,
      headers: { ...this.defaults.headers, ...options.headers },
      cookies: { ...this.defaults.cookies, ...options.cookies },
    };
    if (options.body !== undefined) {
      inject.payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      inject.headers = { 'content-type': 'application/json', ...inject.headers };
    }
    const response = await this.app.inject(inject);
    const text = response.body;
    let body: unknown = text;
    if (text && (response.headers['content-type'] ?? '').toString().includes('application/json')) {
      body = JSON.parse(text);
    }
    return {
      status: response.statusCode,
      body: body as T,
      headers: response.headers,
      cookies: response.cookies,
      raw: response,
    };
  }
}

export type TestApp = {
  app: FastifyInstance;
  /** Requests without any credentials. */
  anonymous: ApiClient;
  /** Requests authenticated with a fresh server-side session for the given seeded user. */
  as(user: TestUser | string): ApiClient;
  /** Requests with a raw session cookie value (for expired, forged, or revoked tokens). */
  withSessionCookie(token: string): ApiClient;
  /** Requests authenticated with the integration bearer token. */
  asService(): ApiClient;
  /** Signs a user in through the real login route and returns a client using the issued cookie. */
  login(
    email: string,
    password: string,
  ): Promise<{ response: ApiResponse; client: ApiClient; token: string | undefined }>;
};

// One application per test file: `server/persistence/database.ts` holds a single connection that
// cannot be reopened once the app closes it, so every `describe` in a file shares this instance.
// This module is evaluated while the test file is collected, so the hook attaches to the file suite.
let sharedApp: Promise<FastifyInstance> | undefined;
afterAll(async () => {
  if (sharedApp) await (await sharedApp).close();
  sharedApp = undefined;
});

async function bootApp() {
  const app = await createApp();
  await app.ready();
  seedTestData();
  return app;
}

/**
 * Boots the real Fastify application once per test file against that file's private database,
 * seeds it, and wraps each test in a transaction that is rolled back afterwards. Tests therefore
 * always start from the same seeded state without the cost of re-migrating.
 */
export function useTestApp(): TestApp {
  let app: FastifyInstance;
  const handle = {} as TestApp;

  beforeAll(async () => {
    app = await (sharedApp ??= bootApp());
    handle.app = app;
    handle.anonymous = new ApiClient(app);
    handle.as = (user) => {
      const userId = typeof user === 'string' ? user : user.id;
      const session = createSession(userId);
      return new ApiClient(app, { cookies: { remonet_session: session.token } });
    };
    handle.withSessionCookie = (token) => new ApiClient(app, { cookies: { remonet_session: token } });
    handle.asService = () => new ApiClient(app, { headers: { authorization: `Bearer ${serviceToken}` } });
    handle.login = async (email, password) => {
      const response = await handle.anonymous.post(
        '/api/auth/login',
        { email, password },
        { headers: { origin: allowedOrigin } },
      );
      const token = response.cookies.find((cookie) => cookie.name === 'remonet_session')?.value;
      return { response, client: handle.withSessionCookie(token ?? ''), token };
    };
  });

  useTransactionPerTest();
  return handle;
}

export function expectError(response: ApiResponse, status: number, message?: string | RegExp) {
  const body = response.body as { error?: string; requestId?: string };
  if (response.status !== status) {
    throw new Error(
      `Expected HTTP ${status} but received ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  if (typeof body?.error !== 'string')
    throw new Error(`Expected an error body, received ${JSON.stringify(body)}`);
  if (
    message instanceof RegExp ? !message.test(body.error) : message !== undefined && body.error !== message
  ) {
    throw new Error(`Expected error "${String(message)}" but received "${body.error}"`);
  }
  return body;
}
