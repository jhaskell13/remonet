import type { AccessRole } from '../../shared/network.ts';

export const roleLabels: Record<AccessRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  viewer: 'Viewer',
};
export const roleDescriptions: Record<AccessRole, string> = {
  owner: 'Full control, including ownership, teams, and the organization itself.',
  admin: 'Manages networks, areas, devices, teams, and operator/viewer members.',
  operator: 'Enrolls and edits devices; read access to everything else.',
  viewer: 'Read-only access to the organization.',
};
