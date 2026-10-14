import type { AccessRole } from '../../shared/network.ts';
import { roleDescriptions, roleLabels } from '../lib/roles.ts';

export function RoleBadge({ role }: { role: AccessRole }) {
  return (
    <span className={`role-badge role-${role}`} title={roleDescriptions[role]}>
      {roleLabels[role]}
    </span>
  );
}
