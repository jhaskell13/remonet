import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  deleteSession,
  findSessionUser,
  getUserByEmail,
  getUserById,
  listOrganizations,
  listUserOrganizations,
  saveSession,
} from './store.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import type { OrganizationAccess } from './store.ts';
import { config } from './config.ts';

export type Principal = {
  id: string;
  email: string;
  displayName: string;
  organizations: OrganizationAccess[];
  sessionToken?: string;
  serviceToken?: boolean;
};
const sessionLifetimeMs = config.sessionLifetimeMs;
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function safeEqual(left: string, right: string) {
  return timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
}
export function hashInvitationToken(token: string) {
  return digest(token);
}

export function authenticate(token?: string, authorization?: string): Principal | null {
  if (token) {
    const session = findSessionUser(hashInvitationToken(token));
    if (session) return { ...session, sessionToken: token };
  }
  if (
    config.apiToken &&
    authorization?.startsWith('Bearer ') &&
    safeEqual(authorization.slice(7), config.apiToken)
  ) {
    return {
      id: 'service-token',
      email: '',
      displayName: 'API integration',
      organizations: listOrganizations(config.apiOrganizationIds).map((org) => ({
        ...org,
        role: 'viewer',
      })) as OrganizationAccess[],
      serviceToken: true,
    };
  }
  return null;
}

export function signIn(email: string, password: string) {
  const user = getUserByEmail(email.trim().toLowerCase());
  const passwordMatches = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !user.isActive || !passwordMatches) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    organizations: listUserOrganizations(user.id),
  };
}
export function createSession(userId: string) {
  const user = getUserById(userId);
  if (!user || !user.isActive) throw new Error('User account is unavailable');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + sessionLifetimeMs;
  saveSession(hashInvitationToken(token), userId, new Date(expiresAt).toISOString());
  return { token, expiresAt };
}
export function destroySession(token?: string) {
  if (token) deleteSession(hashInvitationToken(token));
}
export function sessionCookie(token: string) {
  return `remonet_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${config.isProduction ? '; Secure' : ''}`;
}
export function clearedSessionCookie() {
  return `remonet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.isProduction ? '; Secure' : ''}`;
}
