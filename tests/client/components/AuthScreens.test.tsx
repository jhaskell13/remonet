import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InvitationScreen, LoginScreen } from '../../../src/components/AuthScreens.tsx';
import type { Invitation } from '../../../src/types.ts';
import { sessionFor } from '../helpers/fixtures.ts';

const invitation: Invitation = {
  token: 'invite-token',
  email: 'newcomer@northstar.test',
  organizationName: 'Northstar Engineering',
  teamName: 'Network Operations',
  role: 'operator',
  expiresAt: '2026-01-08T00:00:00.000Z',
  accountExists: false,
};

describe('LoginScreen', () => {
  it('submits the entered credentials', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginScreen onLogin={onLogin} invitation={null} />);
    const email = screen.getByLabelText(/email/i);
    await userEvent.clear(email);
    await userEvent.type(email, 'owner@northstar.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'TestPassword2026!');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onLogin).toHaveBeenCalledWith('owner@northstar.test', 'TestPassword2026!');
  });

  it('shows the server’s refusal and stays on the form', async () => {
    const onLogin = vi.fn().mockRejectedValue(new Error('Email or password is incorrect'));
    render(<LoginScreen onLogin={onLogin} invitation={null} />);
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Email or password is incorrect')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
  });

  it('pre-fills the invited address and explains what signing in will do', () => {
    render(<LoginScreen onLogin={vi.fn()} invitation={{ ...invitation, accountExists: true }} />);
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('newcomer@northstar.test');
    expect(
      screen.getByText(
        /sign in with newcomer@northstar.test to accept an invitation to northstar engineering/i,
      ),
    ).toBeTruthy();
  });

  it('offers the local demo accounts only in development builds', async () => {
    render(<LoginScreen onLogin={vi.fn()} invitation={null} />);
    const demo = screen.queryByRole('button', { name: /solo network/i });
    expect(Boolean(demo)).toBe(import.meta.env.DEV);
    if (demo) {
      await userEvent.click(demo);
      expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('solo@remonet.local');
      expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe('SoloNetwork2026!');
    }
  });
});

describe('InvitationScreen', () => {
  it('registers a new account with a confirmed password', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(<InvitationScreen invitation={invitation} onAccept={onAccept} />);
    expect(screen.getByRole('heading', { name: /join northstar engineering/i })).toBeTruthy();
    expect(screen.getByText('newcomer@northstar.test')).toBeTruthy();
    const name = screen.getByLabelText(/your name/i);
    expect((name as HTMLInputElement).value).toBe('newcomer');
    await userEvent.clear(name);
    await userEvent.type(name, 'New Comer');
    await userEvent.type(screen.getByLabelText(/create password/i), 'FreshPassword2026!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'FreshPassword2026!');
    await userEvent.click(screen.getByRole('button', { name: /create account and join/i }));
    expect(onAccept).toHaveBeenCalledWith({
      token: 'invite-token',
      displayName: 'New Comer',
      password: 'FreshPassword2026!',
    });
  });

  it('refuses mismatched passwords before calling the API', async () => {
    const onAccept = vi.fn();
    render(<InvitationScreen invitation={invitation} onAccept={onAccept} />);
    await userEvent.type(screen.getByLabelText(/create password/i), 'FreshPassword2026!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'FreshPassword2026?');
    await userEvent.click(screen.getByRole('button', { name: /create account and join/i }));
    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('surfaces acceptance failures', async () => {
    const onAccept = vi.fn().mockRejectedValue(new Error('Invitation is invalid or expired'));
    render(<InvitationScreen invitation={invitation} onAccept={onAccept} />);
    await userEvent.type(screen.getByLabelText(/create password/i), 'FreshPassword2026!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'FreshPassword2026!');
    await userEvent.click(screen.getByRole('button', { name: /create account and join/i }));
    expect(await screen.findByText('Invitation is invalid or expired')).toBeTruthy();
  });

  it('lets the invited account accept without re-entering a password', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const session = sessionFor('user-viewer', 'viewer');
    render(
      <InvitationScreen
        invitation={{ ...invitation, email: 'Viewer@Northstar.test', accountExists: true }}
        session={session}
        onAccept={onAccept}
      />,
    );
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^accept invitation$/i }));
    expect(onAccept).toHaveBeenCalledWith({ token: 'invite-token' });
  });

  it('tells a differently signed-in engineer to switch accounts', async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    const session = sessionFor('user-admin', 'admin');
    render(
      <InvitationScreen
        invitation={{ ...invitation, accountExists: true }}
        session={session}
        onAccept={vi.fn()}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText(/you’re signed in as admin@northstar.test/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /accept invitation/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onLogout).toHaveBeenCalled();
  });
});
