import type { OrganizationMembership } from '../shared/network.ts';

export type { OrganizationMembership };
export type OrganizationRole = OrganizationMembership['role'];
export type Session = {
  user: { id: string; email: string; displayName: string };
  organizations: OrganizationMembership[];
};
export type Invitation = {
  token: string;
  email: string;
  organizationName: string;
  teamName: string;
  role: string;
  expiresAt: string;
  accountExists: boolean;
};
