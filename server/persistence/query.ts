import type { Scope } from './types.ts';

export function where(scope: Scope, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const clauses: string[] = [];
  const values: string[] = [];
  if (scope.organizationIds) {
    if (scope.organizationIds.length === 0) clauses.push('1 = 0');
    else {
      clauses.push(`${prefix}organization_id IN (${scope.organizationIds.map(() => '?').join(', ')})`);
      values.push(...scope.organizationIds);
    }
  }
  if (scope.organizationId) { clauses.push(`${prefix}organization_id = ?`); values.push(scope.organizationId); }
  if (scope.networkId) { clauses.push(`${prefix}${alias === 'networks' ? 'id' : 'network_id'} = ?`); values.push(scope.networkId); }
  if (scope.areaId) {
    const areaColumn = alias === 'networks' ? 'id IN (SELECT network_id FROM areas WHERE id = ?)' : alias === 'areas' ? 'id = ?' : 'area_id = ?';
    clauses.push(`${prefix}${areaColumn}`);
    values.push(scope.areaId);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
}
