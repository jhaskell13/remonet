import { useState, type FormEvent } from 'react';
import type { Invitation, Session } from '../types.ts';

export function LoginScreen({
  onLogin,
  invitation,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  invitation: Invitation | null;
}) {
  const [email, setEmail] = useState(invitation?.email ?? 'engineer@remonet.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand auth-brand">
          <span className="brand-mark">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>
            Remo<span className="brand-light">Net</span>
          </span>
        </div>
        <h1>Welcome back</h1>
        <p>
          {invitation
            ? `Sign in with ${invitation.email} to accept an invitation to ${invitation.organizationName}.`
            : 'Sign in to your network workspace.'}
        </p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {import.meta.env.DEV && (
          <div className="demo-logins">
            <small>Local demo accounts</small>
            <button
              type="button"
              onClick={() => {
                setEmail('solo@remonet.local');
                setPassword('SoloNetwork2026!');
              }}
            >
              Solo network <span>solo@remonet.local</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEmail('engineer@remonet.local');
                setPassword('EngineerNetwork2026!');
              }}
            >
              Multi-org engineer <span>engineer@remonet.local</span>
            </button>
          </div>
        )}
      </form>
    </main>
  );
}

export function InvitationScreen({
  invitation,
  session,
  onAccept,
  onLogout,
}: {
  invitation: Invitation;
  session?: Session;
  onAccept: (input: { token: string; displayName?: string; password?: string }) => Promise<void>;
  onLogout?: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(invitation.email.split('@')[0]);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const matchingUser = session?.user.email.toLowerCase() === invitation.email.toLowerCase();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    if (!session && password !== confirmation) {
      setError('Passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      await onAccept({ token: invitation.token, ...(session ? {} : { displayName, password }) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not accept invitation.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand auth-brand">
          <span className="brand-mark">
            <i></i>
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>
            Remo<span className="brand-light">Net</span>
          </span>
        </div>
        <h1>Join {invitation.organizationName}</h1>
        <p>
          Invitation to <b>{invitation.teamName}</b> as <b>{invitation.role}</b>. This link expires{' '}
          {new Date(invitation.expiresAt).toLocaleDateString()}.
        </p>
        <div className="invited-email">{invitation.email}</div>
        {session && !matchingUser ? (
          <>
            <div className="auth-error">
              You’re signed in as {session.user.email}. Sign in with the invited address to accept.
            </div>
            <button className="outline-button" type="button" onClick={() => onLogout?.()}>
              Sign out
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            {!session && (
              <>
                <label>
                  Your name
                  <input
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <label>
                  Create password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={12}
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                    minLength={12}
                  />
                </label>
              </>
            )}
            {error && <div className="auth-error">{error}</div>}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Accepting…' : session ? 'Accept invitation' : 'Create account and join'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
