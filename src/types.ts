import type { Organization } from './data.ts';

export type OrganizationMembership = Organization & { role: 'owner' | 'admin' | 'operator' | 'viewer' };
export type Session = { user: { id: string; email: string; displayName: string }; organizations: OrganizationMembership[] };
export type Invitation = { token: string; email: string; organizationName: string; teamName: string; role: string; expiresAt: string; accountExists: boolean };
