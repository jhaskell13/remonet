import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authenticate, clearedSessionCookie, createSession, destroySession, hashInvitationToken, sessionCookie, signIn } from './auth.ts';
import { hashPassword } from './passwords.ts';
import type { Principal } from './auth.ts';

const port = Number(process.env.API_PORT ?? 3001);
const allowedOrigin = process.env.REMONET_ALLOWED_ORIGIN ?? 'http://localhost:5173';
const appOrigin = process.env.REMONET_APP_ORIGIN ?? allowedOrigin;
const secureCookies = process.env.NODE_ENV === 'production';
const failedLogins = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();
const { acceptInvitation, canManageOrganization, createInvitation, findUserByEmail, getOverview, getUserById, inspectInvitation, listAreas, listDevices, listNetworks, listTeams, listUserOrganizations } = await import('./store.ts');

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function principalOrgIds(principal: Principal) { return principal.organizations.map(organization => organization.id); }
function readScope(url: URL, principal: Principal) {
  const organizationId = url.searchParams.get('organizationId') || undefined;
  if (organizationId && !principalOrgIds(principal).includes(organizationId)) return null;
  return { organizationIds: principalOrgIds(principal), organizationId, networkId: url.searchParams.get('networkId') || undefined, areaId: url.searchParams.get('areaId') || undefined };
}
async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += Buffer.byteLength(chunk);
    if (length > 8192) throw new Error('Request body too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
function originAllowed(req: IncomingMessage) { return !req.headers.origin || req.headers.origin === allowedOrigin; }
function hasText(value: unknown, maxLength = 160): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength; }
function validEmail(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function errorCode(error: unknown) { return error instanceof Error ? error.message : ''; }

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  void handle(req, res).catch(error => {
    console.error('API request failed:', error);
    send(res, error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'Invalid JSON body' : 'Internal server error' });
  });
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }
    if (!originAllowed(req)) { send(res, 403, { error: 'Origin not allowed' }); return; }
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch (error) { send(res, error instanceof SyntaxError ? 400 : 413, { error: error instanceof SyntaxError ? 'Invalid JSON body' : 'Request body too large' }); return; }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (email.length > 254 || password.length > 256) { send(res, 400, { error: 'Invalid credentials' }); return; }
    const attemptKey = `${req.socket.remoteAddress ?? 'unknown'}:${email}`;
    const now = Date.now();
    const attempts = failedLogins.get(attemptKey);
    if (attempts && attempts.blockedUntil > now) { res.setHeader('Retry-After', String(Math.ceil((attempts.blockedUntil - now) / 1000))); send(res, 429, { error: 'Too many sign-in attempts. Try again later.' }); return; }
    const user = signIn(email, password);
    if (!user) {
      const next = !attempts || attempts.resetAt <= now ? { count: 1, resetAt: now + 15 * 60 * 1000, blockedUntil: 0 } : { ...attempts, count: attempts.count + 1 };
      if (next.count >= 8) next.blockedUntil = now + 15 * 60 * 1000;
      failedLogins.set(attemptKey, next);
      send(res, next.blockedUntil ? 429 : 401, { error: next.blockedUntil ? 'Too many sign-in attempts. Try again later.' : 'Email or password is incorrect' });
      return;
    }
    failedLogins.delete(attemptKey);
    const session = createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, secureCookies));
    send(res, 200, { user: { id: user.id, email: user.email, displayName: user.displayName }, organizations: user.organizations });
    return;
  }

  if (url.pathname === '/api/invitations/inspect') {
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch (error) { send(res, error instanceof SyntaxError ? 400 : 413, { error: error instanceof SyntaxError ? 'Invalid JSON body' : 'Request body too large' }); return; }
    if (!hasText(body.token, 256)) { send(res, 400, { error: 'Invitation token is required' }); return; }
    const invitation = inspectInvitation(hashInvitationToken(body.token));
    if (!invitation) { send(res, 404, { error: 'Invitation is invalid or expired' }); return; }
    send(res, 200, { data: invitation });
    return;
  }

  if (url.pathname === '/api/invitations') {
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }
    if (!originAllowed(req)) { send(res, 403, { error: 'Origin not allowed' }); return; }
    const principal = authenticate(req);
    if (!principal || principal.serviceToken) { send(res, 401, { error: 'Sign in with an engineer account to invite teammates' }); return; }
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch (error) { send(res, error instanceof SyntaxError ? 400 : 413, { error: error instanceof SyntaxError ? 'Invalid JSON body' : 'Request body too large' }); return; }
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
    const teamId = typeof body.teamId === 'string' ? body.teamId : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role === 'admin' || body.role === 'operator' ? body.role : body.role === 'viewer' ? 'viewer' : null;
    if (!validEmail(email) || !organizationId || !teamId || !role) { send(res, 400, { error: 'Provide a valid email, team, and role' }); return; }
    if (!principalOrgIds(principal).includes(organizationId) || !canManageOrganization(principal.id, organizationId)) { send(res, 403, { error: 'Organization admin access required' }); return; }
    if (role === 'admin' && principal.organizations.find(organization => organization.id === organizationId)?.role !== 'owner') { send(res, 403, { error: 'Only an organization owner can invite another admin' }); return; }
    if (!listTeams({ organizationIds: [organizationId], organizationId }).some(team => team.id === teamId)) { send(res, 400, { error: 'Team does not belong to this organization' }); return; }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    createInvitation({ id: randomUUID(), email, organizationId, teamId, role, tokenHash: hashInvitationToken(token), invitedBy: principal.id, expiresAt });
    send(res, 201, { email, expiresAt, inviteUrl: `${appOrigin}/#invite=${token}` });
    return;
  }

  if (url.pathname === '/api/invitations/accept') {
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }
    if (!originAllowed(req)) { send(res, 403, { error: 'Origin not allowed' }); return; }
    let body: Record<string, unknown>;
    try { body = await readJson(req); } catch (error) { send(res, error instanceof SyntaxError ? 400 : 413, { error: error instanceof SyntaxError ? 'Invalid JSON body' : 'Request body too large' }); return; }
    if (!hasText(body.token, 256)) { send(res, 400, { error: 'Invitation token is required' }); return; }
    const invitation = inspectInvitation(hashInvitationToken(body.token));
    if (!invitation) { send(res, 404, { error: 'Invitation is invalid or expired' }); return; }
    const principal = authenticate(req);
    let userId: string;
    let newAccount = false;
    if (principal?.serviceToken) { send(res, 403, { error: 'Sign in with an engineer account to accept this invitation' }); return; }
    if (principal && !principal.serviceToken) {
      if (principal.email.toLowerCase() !== invitation.email.toLowerCase()) { send(res, 403, { error: 'Sign in with the invited email address to accept this invitation' }); return; }
      try { userId = acceptInvitation({ tokenHash: hashInvitationToken(body.token), existingUserId: principal.id }); }
      catch (error) { send(res, 409, { error: errorCode(error) === 'INVITATION_INVALID' ? 'Invitation is no longer valid' : 'Could not accept invitation' }); return; }
    } else {
      if (findUserByEmail(invitation.email)) { send(res, 409, { error: 'This email already has an account. Sign in to accept the invitation.' }); return; }
      if (!hasText(body.displayName, 100) || !hasText(body.password, 256) || body.password.length < 12) { send(res, 400, { error: 'Choose a display name and a password of at least 12 characters' }); return; }
      const newUser = { id: randomUUID(), email: invitation.email, displayName: body.displayName.trim(), passwordHash: hashPassword(body.password) };
      try { userId = acceptInvitation({ tokenHash: hashInvitationToken(body.token), user: newUser }); }
      catch (error) {
        const code = errorCode(error);
        send(res, code === 'ACCOUNT_EXISTS' ? 409 : 404, { error: code === 'ACCOUNT_EXISTS' ? 'This email already has an account. Sign in to accept the invitation.' : 'Invitation is invalid or expired' });
        return;
      }
      newAccount = true;
    }
    const account = getUserById(userId);
    if (!account) { send(res, 500, { error: 'Account could not be loaded' }); return; }
    if (newAccount) {
      const session = createSession(userId);
      res.setHeader('Set-Cookie', sessionCookie(session.token, secureCookies));
    }
    send(res, 200, { user: { id: account.id, email: account.email, displayName: account.displayName }, organizations: listUserOrganizations(userId) });
    return;
  }

  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') { send(res, 405, { error: 'Method not allowed' }); return; }
    if (!originAllowed(req)) { send(res, 403, { error: 'Origin not allowed' }); return; }
    const principal = authenticate(req);
    if (principal?.sessionToken) destroySession(principal.sessionToken);
    res.setHeader('Set-Cookie', clearedSessionCookie(secureCookies));
    send(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'GET') { send(res, 405, { error: 'Method not allowed' }); return; }
  const principal = authenticate(req);
  if (!principal) { send(res, 401, { error: 'Unauthorized' }); return; }
  if (url.pathname === '/api/auth/me') {
    send(res, 200, { user: { id: principal.id, email: principal.email, displayName: principal.displayName }, organizations: principal.organizations });
    return;
  }
  const scope = readScope(url, principal);
  if (!scope) { send(res, 403, { error: 'Organization access denied' }); return; }
  if (url.pathname === '/api/health') { send(res, 200, { status: 'ok', service: 'remonet-api' }); return; }
  if (url.pathname === '/api/overview') { send(res, 200, { data: getOverview(scope) }); return; }
  if (url.pathname === '/api/organizations') { send(res, 200, { data: principal.organizations }); return; }
  if (url.pathname === '/api/networks') { send(res, 200, { data: listNetworks(scope) }); return; }
  if (url.pathname === '/api/areas') { send(res, 200, { data: listAreas(scope) }); return; }
  if (url.pathname === '/api/devices') { send(res, 200, { data: listDevices(scope) }); return; }
  if (url.pathname === '/api/teams') { send(res, 200, { data: listTeams(scope) }); return; }
  send(res, 404, { error: 'Not found' });
}

server.listen(port, () => console.log(`RemoNet API listening on http://localhost:${port}`));
