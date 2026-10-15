// Compatibility barrel; feature services import repositories through one stable entry point.
export type {
  AccessRole,
  AuditEvent,
  DeviceObservation,
  InvitationRecord,
  OrganizationAccess,
  OrganizationMember,
  PendingInvitation,
  Scope,
  Team,
  UserRecord,
} from './persistence/types.ts';
export {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
} from './persistence/repositories/organization-repository.ts';
export {
  getOverview,
  listAreas,
  listDevices,
  listNetworks,
} from './persistence/repositories/network-repository.ts';
export {
  createTeam,
  deleteTeamIfEmpty,
  getTeam,
  listTeams,
  updateTeam,
} from './persistence/repositories/team-repository.ts';
export {
  addMembership,
  countOtherActiveOwners,
  getMembership,
  getOrganizationRole,
  listOrganizationMembers,
  removeMembership,
  updateMembershipRole,
} from './persistence/repositories/membership-repository.ts';
export {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listPendingInvitations,
  revokeInvitation,
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
export { insertAuditEvent, listAuditEvents } from './persistence/repositories/audit-repository.ts';
export {
  countObservations,
  getLatestObservation,
  insertObservation,
  listObservationsForDevice,
  pruneObservations,
} from './persistence/repositories/device-observation-repository.ts';
