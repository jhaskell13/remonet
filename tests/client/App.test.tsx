import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.tsx';
import { ApiError } from '../../src/api/client.ts';
import { apiMock } from './helpers/api-mock.ts';
import { sessionFor } from './helpers/fixtures.ts';

vi.mock('../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('./helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

const invitation = {
  id: 'inv-1',
  email: 'newcomer@northstar.test',
  organizationId: 'org-demo',
  organizationName: 'Northstar Engineering',
  teamId: 'team-ops',
  teamName: 'Network Operations',
  role: 'viewer',
  expiresAt: '2026-01-08T00:00:00.000Z',
  accountExists: false,
};

describe('App session bootstrap', () => {
  beforeEach(() => {
    apiMock.reset();
    window.location.hash = '';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('shows the dashboard when a session cookie is still valid', async () => {
    apiMock.current.currentSession.mockResolvedValue(sessionFor('user-admin', 'admin'));
    render(<App />);
    expect(screen.getByText(/connecting to remonet/i)).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /welcome, northstar admin/i })).toBeTruthy();
  });

  it('shows the login screen without a session and signs in', async () => {
    apiMock.current.currentSession.mockRejectedValue(new ApiError('Unauthorized', 401));
    apiMock.current.login.mockResolvedValue(sessionFor('user-owner', 'owner'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/password/i), 'TestPassword2026!');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: /welcome, northstar owner/i })).toBeTruthy();
  });

  it('signs out and returns to the login screen even if the logout call fails', async () => {
    apiMock.current.currentSession.mockResolvedValue(sessionFor('user-admin', 'admin'));
    apiMock.current.logout.mockRejectedValue(new Error('offline'));
    render(<App />);
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
  });

  it('drops the session when the API answers 401 while loading data', async () => {
    apiMock.current.currentSession.mockResolvedValue(sessionFor('user-admin', 'admin'));
    apiMock.current.devices.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    expect(apiMock.current.logout).toHaveBeenCalled();
  });

  it('routes an invitation link for a new person to the registration screen', async () => {
    window.location.hash = '#invite=abc123';
    apiMock.current.currentSession.mockRejectedValue(new ApiError('Unauthorized', 401));
    apiMock.current.inspectInvitation.mockResolvedValue({ data: invitation });
    apiMock.current.acceptInvitation.mockResolvedValue(sessionFor('user-viewer', 'viewer'));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /join northstar engineering/i })).toBeTruthy();
    expect(apiMock.current.inspectInvitation).toHaveBeenCalledWith('abc123');
    await userEvent.type(screen.getByLabelText(/create password/i), 'FreshPassword2026!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'FreshPassword2026!');
    await userEvent.click(screen.getByRole('button', { name: /create account and join/i }));
    expect(await screen.findByRole('heading', { name: /welcome, northstar viewer/i })).toBeTruthy();
    expect(apiMock.current.acceptInvitation).toHaveBeenCalledWith({
      token: 'abc123',
      displayName: 'newcomer',
      password: 'FreshPassword2026!',
    });
    expect(window.location.hash).toBe('');
  });

  it('asks an existing but signed-out person to sign in first', async () => {
    window.location.hash = '#invite=abc123';
    apiMock.current.currentSession.mockRejectedValue(new ApiError('Unauthorized', 401));
    apiMock.current.inspectInvitation.mockResolvedValue({ data: { ...invitation, accountExists: true } });
    render(<App />);
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    expect(screen.getByText(/sign in with newcomer@northstar.test to accept/i)).toBeTruthy();
  });

  it('lets a signed-in engineer accept an invitation for their own address', async () => {
    window.location.hash = '#invite=abc123';
    apiMock.current.currentSession.mockResolvedValue(sessionFor('user-viewer', 'viewer'));
    apiMock.current.inspectInvitation.mockResolvedValue({
      data: { ...invitation, email: 'viewer@northstar.test', accountExists: true },
    });
    apiMock.current.acceptInvitation.mockResolvedValue(sessionFor('user-viewer', 'operator'));
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /^accept invitation$/i }));
    expect(apiMock.current.acceptInvitation).toHaveBeenCalledWith({ token: 'abc123' });
    expect(await screen.findByRole('heading', { name: /welcome, northstar viewer/i })).toBeTruthy();
  });

  it('explains an invalid invitation and returns to sign in', async () => {
    window.location.hash = '#invite=expired';
    apiMock.current.currentSession.mockRejectedValue(new ApiError('Unauthorized', 401));
    apiMock.current.inspectInvitation.mockRejectedValue(
      new ApiError('Invitation is invalid or expired', 404),
    );
    render(<App />);
    expect(await screen.findByRole('heading', { name: /invitation unavailable/i })).toBeTruthy();
    expect(screen.getByText('Invitation is invalid or expired')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /return to sign in/i }));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe(''));
  });
});
