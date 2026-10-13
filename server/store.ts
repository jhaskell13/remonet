// Compatibility barrel; feature services import repositories through one stable entry point.
export type {
  AccessRole,
  InvitationRecord,
  OrganizationAccess,
  Scope,
  UserRecord,
} from './persistence/types.ts';
export { listOrganizations } from './persistence/repositories/organization-repository.ts';
export {
  getOverview,
  listAreas,
  listDevices,
  listNetworks,
} from './persistence/repositories/network-repository.ts';
export { canManageOrganization, listTeams } from './persistence/repositories/team-repository.ts';
export {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
} from './persistence/repositories/invitation-repository.ts';
export {
  createUser,
  findUserByEmail,
  getUserByEmail,
  getUserById,
  listUserOrganizations,
} from './persistence/repositories/user-repository.ts';
export {
  deleteSession,
  findSessionUser,
  saveSession,
} from './persistence/repositories/session-repository.ts';
