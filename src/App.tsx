import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api/client';
import Dashboard from './components/Dashboard';
import { InvitationScreen, LoginScreen } from './components/AuthScreens';
import type { Invitation, Session } from './types';
import './style.css';

function readInviteToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite');
}
function clearInviteToken() {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    let active = true;
    async function initialize() {
      const token = readInviteToken();
      try {
        const currentSession = await api.currentSession();
        if (active) setSession(currentSession);
      } catch {
        /* The login screen will show a useful error when the API is unavailable. */
      }
      if (token) {
        try {
          const result = await api.inspectInvitation(token);
          if (active) setInvitation({ token, ...result.data });
        } catch (reason) {
          if (active)
            setInviteError(reason instanceof Error ? reason.message : 'Could not verify this invitation.');
        }
      }
      if (active) setCheckingSession(false);
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);
  async function login(email: string, password: string) {
    setSession(await api.login(email, password));
  }
  async function acceptInvitation(input: { token: string; displayName?: string; password?: string }) {
    const result = await api.acceptInvitation(input);
    setSession(result);
    setInvitation(null);
    setInviteError('');
    clearInviteToken();
  }
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setSession(null);
  }, []);
  const refreshSession = useCallback(async () => {
    try {
      setSession(await api.currentSession());
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setSession(null);
    }
  }, []);
  if (checkingSession) return <div className="auth-loading">Connecting to RemoNet…</div>;
  if (inviteError)
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand auth-brand">
            Remo<span className="brand-light">Net</span>
          </div>
          <h1>Invitation unavailable</h1>
          <p>{inviteError}</p>
          <button
            className="outline-button"
            onClick={() => {
              clearInviteToken();
              setInviteError('');
            }}
          >
            Return to sign in
          </button>
        </section>
      </main>
    );
  if (invitation && session)
    return (
      <InvitationScreen
        invitation={invitation}
        session={session}
        onAccept={acceptInvitation}
        onLogout={logout}
      />
    );
  if (invitation && !session && !invitation.accountExists)
    return <InvitationScreen invitation={invitation} onAccept={acceptInvitation} />;
  if (!session) return <LoginScreen onLogin={login} invitation={invitation} />;
  return (
    <Dashboard
      key={session.user.id}
      user={session.user}
      organizations={session.organizations}
      onLogout={logout}
      onSessionChanged={refreshSession}
    />
  );
}

export default App;
