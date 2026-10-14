import { afterEach, describe, expect, it, vi } from 'vitest';

// `server/config.ts` validates the environment once at import time. Each scenario below resets the
// module registry and imports it fresh against a controlled environment.
const managed = [
  'NODE_ENV',
  'API_HOST',
  'API_PORT',
  'REMONET_DB_PATH',
  'REMONET_ALLOWED_ORIGIN',
  'REMONET_APP_ORIGIN',
  'REMONET_SEED_DEMO',
  'REMONET_API_TOKEN',
  'REMONET_API_ORGANIZATION_IDS',
  'REMONET_BOOTSTRAP_EMAIL',
  'REMONET_BOOTSTRAP_PASSWORD',
  'REMONET_BOOTSTRAP_DISPLAY_NAME',
  'REMONET_BOOTSTRAP_ORGANIZATION_ID',
  'REMONET_BOOTSTRAP_ORGANIZATION_NAME',
];
const original = Object.fromEntries(managed.map((name) => [name, process.env[name]]));

async function loadConfig(env: Record<string, string | undefined>) {
  for (const name of managed) delete process.env[name];
  for (const [name, value] of Object.entries(env)) if (value !== undefined) process.env[name] = value;
  vi.resetModules();
  return import('../../../server/config.ts');
}
const failure = (env: Record<string, string | undefined>) =>
  loadConfig(env).then(
    () => 'loaded',
    (error: Error) => error.message,
  );
const https = {
  REMONET_ALLOWED_ORIGIN: 'https://remonet.example',
  REMONET_APP_ORIGIN: 'https://remonet.example',
};

afterEach(() => {
  for (const name of managed) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  vi.resetModules();
});

describe('configuration defaults', () => {
  it('falls back to local development settings', async () => {
    const { config } = await loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      seedDemoData: true,
      host: '127.0.0.1',
      port: 3001,
      databasePath: 'data/remonet.sqlite',
      allowedOrigin: 'http://127.0.0.1:5173',
      appOrigin: 'http://127.0.0.1:5173',
      apiToken: undefined,
      apiOrganizationIds: ['org-demo'],
      bootstrap: undefined,
      bodyLimitBytes: 8_192,
      sessionLifetimeMs: 8 * 60 * 60 * 1000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('normalises origins and derives the app origin from the allowed origin', async () => {
    const { config } = await loadConfig({ REMONET_ALLOWED_ORIGIN: 'http://localhost:8080/' });
    expect(config.allowedOrigin).toBe('http://localhost:8080');
    expect(config.appOrigin).toBe('http://localhost:8080');
  });

  it('parses the integration organization list', async () => {
    const { config } = await loadConfig({ REMONET_API_ORGANIZATION_IDS: ' org-a, org-b ,, ' });
    expect(config.apiOrganizationIds).toEqual(['org-a', 'org-b']);
  });

  it('only seeds demo data in development', async () => {
    expect(
      (await loadConfig({ NODE_ENV: 'development', REMONET_SEED_DEMO: 'false' })).config.seedDemoData,
    ).toBe(false);
    expect((await loadConfig({ NODE_ENV: 'test', REMONET_SEED_DEMO: 'true' })).config.seedDemoData).toBe(
      false,
    );
    expect(
      (await loadConfig({ NODE_ENV: 'production', REMONET_SEED_DEMO: 'true', ...https })).config.seedDemoData,
    ).toBe(false);
  });
});

describe('configuration validation refuses to start on', () => {
  it.each([
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV must be development, test, or production'],
    ['a non-numeric port', { API_PORT: 'http' }, 'API_PORT must be an integer between 1 and 65535'],
    ['a port of zero', { API_PORT: '0' }, 'API_PORT must be an integer between 1 and 65535'],
    ['a port above 65535', { API_PORT: '70000' }, 'API_PORT must be an integer between 1 and 65535'],
    ['a fractional port', { API_PORT: '3001.5' }, 'API_PORT must be an integer between 1 and 65535'],
    [
      'an allowed origin with a path',
      { REMONET_ALLOWED_ORIGIN: 'http://127.0.0.1:5173/app' },
      'REMONET_ALLOWED_ORIGIN must be an absolute origin without a path',
    ],
    [
      'an allowed origin that is not a URL',
      { REMONET_ALLOWED_ORIGIN: '127.0.0.1:5173' },
      'REMONET_ALLOWED_ORIGIN must be an absolute origin without a path',
    ],
    [
      'an app origin with a query string',
      { REMONET_APP_ORIGIN: 'http://127.0.0.1:5173/?x=1' },
      'REMONET_APP_ORIGIN must be an absolute origin without a path',
    ],
    [
      'production with an HTTP allowed origin',
      {
        NODE_ENV: 'production',
        REMONET_ALLOWED_ORIGIN: 'http://remonet.example',
        REMONET_APP_ORIGIN: 'https://remonet.example',
      },
      'Production REMONET_ALLOWED_ORIGIN and REMONET_APP_ORIGIN must use HTTPS',
    ],
    [
      'production with an HTTP app origin',
      {
        NODE_ENV: 'production',
        REMONET_ALLOWED_ORIGIN: 'https://remonet.example',
        REMONET_APP_ORIGIN: 'http://remonet.example',
      },
      'Production REMONET_ALLOWED_ORIGIN and REMONET_APP_ORIGIN must use HTTPS',
    ],
    [
      'a short integration token',
      { REMONET_API_TOKEN: 'short-token' },
      'REMONET_API_TOKEN must contain at least 32 characters',
    ],
    ['an invalid seed flag', { REMONET_SEED_DEMO: 'yes' }, 'REMONET_SEED_DEMO must be true or false'],
    [
      'a bootstrap email without a password',
      { REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example' },
      'Set both REMONET_BOOTSTRAP_EMAIL and REMONET_BOOTSTRAP_PASSWORD',
    ],
    [
      'a bootstrap password without an email',
      { REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!' },
      'Set both REMONET_BOOTSTRAP_EMAIL and REMONET_BOOTSTRAP_PASSWORD',
    ],
    [
      'bootstrap options without credentials',
      { REMONET_BOOTSTRAP_ORGANIZATION_NAME: 'Acme' },
      'Bootstrap options require both REMONET_BOOTSTRAP_EMAIL and REMONET_BOOTSTRAP_PASSWORD',
    ],
    [
      'a malformed bootstrap email',
      { REMONET_BOOTSTRAP_EMAIL: 'owner', REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!' },
      'REMONET_BOOTSTRAP_EMAIL must be a valid email address',
    ],
    [
      'a short bootstrap password',
      { REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example', REMONET_BOOTSTRAP_PASSWORD: 'short' },
      'REMONET_BOOTSTRAP_PASSWORD must contain 12 to 256 characters',
    ],
    [
      'an oversized bootstrap password',
      { REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example', REMONET_BOOTSTRAP_PASSWORD: 'p'.repeat(257) },
      'REMONET_BOOTSTRAP_PASSWORD must contain 12 to 256 characters',
    ],
    [
      'a blank bootstrap display name',
      {
        REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example',
        REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!',
        REMONET_BOOTSTRAP_DISPLAY_NAME: '   ',
      },
      'REMONET_BOOTSTRAP_DISPLAY_NAME must contain 1 to 100 characters',
    ],
    [
      'an oversized bootstrap display name',
      {
        REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example',
        REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!',
        REMONET_BOOTSTRAP_DISPLAY_NAME: 'n'.repeat(101),
      },
      'REMONET_BOOTSTRAP_DISPLAY_NAME must contain 1 to 100 characters',
    ],
    [
      'a bootstrap organization id with unsafe characters',
      {
        REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example',
        REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!',
        REMONET_BOOTSTRAP_ORGANIZATION_ID: 'org demo/1',
      },
      'REMONET_BOOTSTRAP_ORGANIZATION_ID may contain only letters, numbers, hyphens, and underscores',
    ],
    [
      'a blank bootstrap organization name',
      {
        REMONET_BOOTSTRAP_EMAIL: 'owner@remonet.example',
        REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!',
        REMONET_BOOTSTRAP_ORGANIZATION_NAME: ' ',
      },
      'REMONET_BOOTSTRAP_ORGANIZATION_NAME must contain 1 to 160 characters',
    ],
  ] as const)('%s', async (_name, env, message) => {
    expect(await failure(env)).toBe(message);
  });
});

describe('bootstrap credentials', () => {
  const credentials = {
    REMONET_BOOTSTRAP_EMAIL: '  Owner@Remonet.Example ',
    REMONET_BOOTSTRAP_PASSWORD: 'BootstrapPassword2026!',
  };

  it('are normalised and default the display name and organization', async () => {
    const { config } = await loadConfig(credentials);
    expect(config.bootstrap).toEqual({
      email: 'owner@remonet.example',
      password: 'BootstrapPassword2026!',
      displayName: 'owner@remonet.example',
      organizationId: 'org-remonet',
      organizationName: 'RemoNet Workspace',
    });
  });

  it('accept explicit display name and organization', async () => {
    const { config } = await loadConfig({
      ...credentials,
      REMONET_BOOTSTRAP_DISPLAY_NAME: ' First Owner ',
      REMONET_BOOTSTRAP_ORGANIZATION_ID: 'org_first-1',
      REMONET_BOOTSTRAP_ORGANIZATION_NAME: ' First Organization ',
    });
    expect(config.bootstrap).toMatchObject({
      displayName: 'First Owner',
      organizationId: 'org_first-1',
      organizationName: 'First Organization',
    });
  });
});

describe('isAllowedOrigin', () => {
  it('accepts the configured origin exactly', async () => {
    const { isAllowedOrigin } = await loadConfig({
      NODE_ENV: 'test',
      REMONET_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
    });
    expect(isAllowedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173/')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(false);
    expect(isAllowedOrigin('https://127.0.0.1:5173')).toBe(false);
    expect(isAllowedOrigin('not an origin')).toBe(false);
  });

  it('widens to loopback aliases on the same port in development only', async () => {
    const development = await loadConfig({
      NODE_ENV: 'development',
      REMONET_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
    });
    expect(development.isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(development.isAllowedOrigin('http://[::1]:5173')).toBe(true);
    expect(development.isAllowedOrigin('http://localhost:5174')).toBe(false);
    expect(development.isAllowedOrigin('https://localhost:5173')).toBe(false);
    expect(development.isAllowedOrigin('http://evil.example:5173')).toBe(false);
    expect(development.isAllowedOrigin('garbage')).toBe(false);

    const production = await loadConfig({ NODE_ENV: 'production', ...https });
    expect(production.isAllowedOrigin('https://remonet.example')).toBe(true);
    expect(production.isAllowedOrigin('http://localhost:443')).toBe(false);
  });
});
