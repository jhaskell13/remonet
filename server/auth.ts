import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { deleteSession, findSessionUser, getUserByEmail, getUserById, listOrganizations, listUserOrganizations, saveSession } from './store.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import type { OrganizationAccess } from './store.ts';

export type Principal = { id: string; email: string; displayName: string; organizations: OrganizationAccess[]; sessionToken?: string; serviceToken?: boolean };
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));
const apiToken = process.env.REMONET_API_TOKEN;
const apiOrganizationIds = (process.env.REMONET_API_ORGANIZATION_IDS ?? 'org-demo').split(',').map(id => id.trim()).filter(Boolean);

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
function safeEqual(left: string, right: string) { return timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right))); }
export function hashInvitationToken(token: string) { return digest(token); }

export function authenticate(req: IncomingMessage): Principal | null {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('remonet_session='));
  const token = cookie?.slice('remonet_session='.length);
  if (token) {
    const session = findSessionUser(hashInvitationToken(token));
    if (session) return { ...session, sessionToken: token };
  }
  const authorization = req.headers.authorization;
  if (apiToken && authorization?.startsWith('Bearer ') && safeEqual(authorization.slice(7), apiToken)) {
    return { id: 'service-token', email: '', displayName: 'API integration', organizations: listOrganizations(apiOrganizationIds).map(org => ({ ...org, role: 'viewer' })) as OrganizationAccess[], serviceToken: true };
  }
  return null;
}

export function signIn(email: string, password: string) {
  const user = getUserByEmail(email.trim().toLowerCase());
  const passwordMatches = verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);
  if (!user || !user.isActive || !passwordMatches) return null;
  return { id: user.id, email: user.email, displayName: user.displayName, organizations: listUserOrganizations(user.id) };
}
export function createSession(userId: string) {
  const user = getUserById(userId);
  if (!user || !user.isActive) throw new Error('User account is unavailable');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + sessionLifetimeMs;
  saveSession(hashInvitationToken(token), userId, new Date(expiresAt).toISOString());
  return { token, expiresAt };
}
export function destroySession(token?: string) { if (token) deleteSession(hashInvitationToken(token)); }
export function sessionCookie(token: string, secure: boolean) {
  return `remonet_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}
export function clearedSessionCookie(secure: boolean) { return `remonet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`; }
