import { useEffect, useRef, useState } from 'react';
import type { OrganizationMembership } from '../types.ts';
import { RoleBadge } from './RoleBadge.tsx';

/**
 * Sidebar organization switcher. Shows the current workspace with the engineer's role in it and
 * lets them move between every organization their single account belongs to.
 */
export function WorkspaceSwitcher({
  organizations,
  organizationId,
  email,
  onSelect,
  onCreate,
}: {
  organizations: OrganizationMembership[];
  organizationId: string;
  email: string;
  onSelect: (organizationId: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const current = organizations.find((organization) => organization.id === organizationId);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="workspace-switcher" ref={container}>
      <button
        type="button"
        className="workspace"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="workspace-icon">{(current?.name ?? 'All').slice(0, 1).toUpperCase()}</span>
        <span className="workspace-text">
          <b>{current?.name ?? 'All organizations'}</b>
          <small>{current ? <RoleBadge role={current.role} /> : email}</small>
        </span>
        <span className="chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="workspace-menu" role="listbox" aria-label="Switch organization">
          {organizations.map((organization) => (
            <button
              type="button"
              key={organization.id}
              role="option"
              aria-selected={organization.id === organizationId}
              className={organization.id === organizationId ? 'selected' : ''}
              onClick={() => {
                onSelect(organization.id);
                setOpen(false);
              }}
            >
              <span>{organization.name}</span>
              <RoleBadge role={organization.role} />
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={!organizationId}
            className={!organizationId ? 'selected' : ''}
            onClick={() => {
              onSelect('');
              setOpen(false);
            }}
          >
            <span>All organizations</span>
          </button>
          <button
            type="button"
            className="workspace-menu-create"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            ＋ New organization
          </button>
        </div>
      )}
    </div>
  );
}
