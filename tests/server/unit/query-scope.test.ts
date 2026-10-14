import { describe, expect, it } from 'vitest';
import { where } from '../../../server/persistence/query.ts';

describe('scope → SQL builder', () => {
  it('produces no clause for an empty scope', () => {
    expect(where({})).toEqual({ sql: '', values: [] });
  });

  it('short-circuits to an always-false clause when the principal has no organizations', () => {
    expect(where({ organizationIds: [] }, 'devices')).toEqual({ sql: ' WHERE 1 = 0', values: [] });
    expect(where({ organizationIds: [], organizationId: 'org-demo' }, 'devices')).toEqual({
      sql: ' WHERE 1 = 0 AND devices.organization_id = ?',
      values: ['org-demo'],
    });
  });

  it('always intersects the membership list with any explicit organization filter', () => {
    expect(where({ organizationIds: ['org-a', 'org-b'], organizationId: 'org-z' }, 'networks')).toEqual({
      sql: ' WHERE networks.organization_id IN (?, ?) AND networks.organization_id = ?',
      values: ['org-a', 'org-b', 'org-z'],
    });
  });

  it('maps network and area filters to the right column per table', () => {
    expect(where({ networkId: 'net', areaId: 'area' }, 'networks')).toEqual({
      sql: ' WHERE networks.id = ? AND networks.id IN (SELECT network_id FROM areas WHERE id = ?)',
      values: ['net', 'area'],
    });
    expect(where({ networkId: 'net', areaId: 'area' }, 'areas')).toEqual({
      sql: ' WHERE areas.network_id = ? AND areas.id = ?',
      values: ['net', 'area'],
    });
    expect(where({ networkId: 'net', areaId: 'area' }, 'devices')).toEqual({
      sql: ' WHERE devices.network_id = ? AND devices.area_id = ?',
      values: ['net', 'area'],
    });
    expect(where({ networkId: 'net' })).toEqual({ sql: ' WHERE network_id = ?', values: ['net'] });
  });

  it('never interpolates values into the SQL text', () => {
    const hostile = "x' OR '1'='1";
    const { sql, values } = where(
      { organizationIds: [hostile], organizationId: hostile, networkId: hostile, areaId: hostile },
      'devices',
    );
    expect(sql).not.toContain(hostile);
    expect(values).toEqual([hostile, hostile, hostile, hostile]);
  });
});
