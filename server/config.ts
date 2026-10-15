function requiredPositiveInteger(name: string, value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error(`${name} must be an integer between 1 and 65535`);
  return parsed;
}

function origin(name: string, value: string | undefined, fallback: string) {
  try {
    const parsed = new URL(value ?? fallback);
    if (parsed.origin !== (value ?? fallback).replace(/\/$/, '')) throw new Error();
    return parsed.origin;
  } catch {
    throw new Error(`${name} must be an absolute origin without a path`);
  }
}

function boundedInteger(name: string, value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
if (!['development', 'test', 'production'].includes(nodeEnv))
  throw new Error('NODE_ENV must be development, test, or production');

// The simulator stands in for hardware during development; elsewhere collection is opt-in.
const collector = process.env.REMONET_COLLECTOR ?? (nodeEnv === 'development' ? 'simulator' : 'off');
if (collector !== 'simulator' && collector !== 'off')
  throw new Error('REMONET_COLLECTOR must be simulator or off');

const allowedOrigin = origin(
  'REMONET_ALLOWED_ORIGIN',
  process.env.REMONET_ALLOWED_ORIGIN,
  'http://127.0.0.1:5173',
);
const appOrigin = origin('REMONET_APP_ORIGIN', process.env.REMONET_APP_ORIGIN, allowedOrigin);
if (
  nodeEnv === 'production' &&
  (!allowedOrigin.startsWith('https://') || !appOrigin.startsWith('https://'))
) {
  throw new Error('Production REMONET_ALLOWED_ORIGIN and REMONET_APP_ORIGIN must use HTTPS');
}

export function isAllowedOrigin(value: string) {
  if (value === allowedOrigin) return true;
  if (nodeEnv !== 'development') return false;

  try {
    const candidate = new URL(value);
    const configured = new URL(allowedOrigin);
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    return (
      candidate.protocol === 'http:' &&
      configured.protocol === 'http:' &&
      localHosts.has(candidate.hostname) &&
      localHosts.has(configured.hostname) &&
      candidate.port === configured.port
    );
  } catch {
    return false;
  }
}

const apiToken = process.env.REMONET_API_TOKEN;
if (apiToken && apiToken.length < 32)
  throw new Error('REMONET_API_TOKEN must contain at least 32 characters');

const seedSetting = process.env.REMONET_SEED_DEMO ?? 'true';
if (seedSetting !== 'true' && seedSetting !== 'false')
  throw new Error('REMONET_SEED_DEMO must be true or false');

const bootstrapEmail = process.env.REMONET_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const bootstrapPassword = process.env.REMONET_BOOTSTRAP_PASSWORD;
const bootstrapOptionsPresent = [
  bootstrapEmail,
  bootstrapPassword,
  process.env.REMONET_BOOTSTRAP_DISPLAY_NAME,
  process.env.REMONET_BOOTSTRAP_ORGANIZATION_ID,
  process.env.REMONET_BOOTSTRAP_ORGANIZATION_NAME,
].some(Boolean);
if (Boolean(bootstrapEmail) !== Boolean(bootstrapPassword))
  throw new Error('Set both REMONET_BOOTSTRAP_EMAIL and REMONET_BOOTSTRAP_PASSWORD');
if (bootstrapOptionsPresent && (!bootstrapEmail || !bootstrapPassword))
  throw new Error('Bootstrap options require both REMONET_BOOTSTRAP_EMAIL and REMONET_BOOTSTRAP_PASSWORD');
if (bootstrapEmail && !/^\S+@\S+\.\S+$/.test(bootstrapEmail))
  throw new Error('REMONET_BOOTSTRAP_EMAIL must be a valid email address');
if (bootstrapPassword && (bootstrapPassword.length < 12 || bootstrapPassword.length > 256))
  throw new Error('REMONET_BOOTSTRAP_PASSWORD must contain 12 to 256 characters');

const bootstrapDisplayName = process.env.REMONET_BOOTSTRAP_DISPLAY_NAME?.trim();
if (bootstrapDisplayName !== undefined && (!bootstrapDisplayName || bootstrapDisplayName.length > 100))
  throw new Error('REMONET_BOOTSTRAP_DISPLAY_NAME must contain 1 to 100 characters');
const bootstrapOrganizationId = process.env.REMONET_BOOTSTRAP_ORGANIZATION_ID ?? 'org-remonet';
if (!/^[a-zA-Z0-9_-]{1,120}$/.test(bootstrapOrganizationId))
  throw new Error(
    'REMONET_BOOTSTRAP_ORGANIZATION_ID may contain only letters, numbers, hyphens, and underscores',
  );
const bootstrapOrganizationName = process.env.REMONET_BOOTSTRAP_ORGANIZATION_NAME ?? 'RemoNet Workspace';
if (!bootstrapOrganizationName.trim() || bootstrapOrganizationName.length > 160)
  throw new Error('REMONET_BOOTSTRAP_ORGANIZATION_NAME must contain 1 to 160 characters');
const bootstrap =
  bootstrapEmail && bootstrapPassword
    ? {
        email: bootstrapEmail,
        password: bootstrapPassword,
        displayName: bootstrapDisplayName ?? bootstrapEmail,
        organizationId: bootstrapOrganizationId,
        organizationName: bootstrapOrganizationName.trim(),
      }
    : undefined;

export const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  seedDemoData: nodeEnv === 'development' && seedSetting === 'true',
  host: process.env.API_HOST ?? '127.0.0.1',
  port: requiredPositiveInteger('API_PORT', process.env.API_PORT, 3001),
  databasePath: process.env.REMONET_DB_PATH ?? 'data/remonet.sqlite',
  allowedOrigin,
  appOrigin,
  apiToken,
  apiOrganizationIds: (process.env.REMONET_API_ORGANIZATION_IDS ?? 'org-demo')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  bootstrap,
  bodyLimitBytes: 8_192,
  sessionLifetimeMs: 8 * 60 * 60 * 1000,
  monitoring: Object.freeze({
    /** Which collector the scheduler runs, or `off` to collect nothing. */
    collector: collector as 'simulator' | 'off',
    /** Observations kept per device; older rows are pruned as new ones are recorded. */
    observationRetentionPerDevice: boundedInteger(
      'REMONET_OBSERVATION_RETENTION',
      process.env.REMONET_OBSERVATION_RETENTION,
      200,
      1,
      100_000,
    ),
    /** How long one check may take, including the collector's own retries of a packet, before it is cancelled. */
    checkTimeoutMs: boundedInteger(
      'REMONET_CHECK_TIMEOUT_MS',
      process.env.REMONET_CHECK_TIMEOUT_MS,
      3_000,
      100,
      120_000,
    ),
    /** Checks in flight at once across all networks. */
    maxConcurrentChecks: boundedInteger(
      'REMONET_MAX_CONCURRENT_CHECKS',
      process.env.REMONET_MAX_CONCURRENT_CHECKS,
      8,
      1,
      256,
    ),
    /** Attempts per device per cycle before a failure is recorded; retries back off exponentially. */
    checkAttempts: boundedInteger('REMONET_CHECK_ATTEMPTS', process.env.REMONET_CHECK_ATTEMPTS, 3, 1, 10),
    /** A device whose last successful check is older than this is reported Offline. */
    staleAfterMs:
      boundedInteger('REMONET_STALE_AFTER_SECONDS', process.env.REMONET_STALE_AFTER_SECONDS, 300, 5, 86_400) *
      1000,
  }),
});
