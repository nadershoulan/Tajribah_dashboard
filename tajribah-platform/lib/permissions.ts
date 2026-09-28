/**
 * Roles and permissions, as data.
 *
 * This file is imported by the schema, by the API and by the dashboard, so it must stay
 * free of database and server imports — a client bundle that pulls in Drizzle because it
 * wanted a role label is a real cost, and it happens exactly this way.
 *
 * The *enforcement* lives in `server/core/rbac/permissions.ts`, which throws. Here there is
 * only the table of who may do what.
 */
export const MEMBER_ROLE = ['owner', 'admin', 'editor', 'analyst', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLE)[number];

/** What each role is called on screen (team, store switcher, admin console). */
export const ROLE_LABEL: Record<MemberRole, { ar: string; en: string }> = {
  owner: { ar: 'مالك', en: 'Owner' },
  admin: { ar: 'مدير', en: 'Admin' },
  editor: { ar: 'محرّر', en: 'Editor' },
  analyst: { ar: 'محلّل', en: 'Analyst' },
  viewer: { ar: 'مشاهد', en: 'Viewer' },
};

export const PERMISSIONS = [
  'products:read', 'products:write', 'products:delete',
  'models:read', 'models:write', 'models:publish',
  'ar:read', 'ar:write', 'ar:publish',
  'tryon:read', 'tryon:write',
  'connections:read', 'connections:write',
  'analytics:read', 'analytics:export',
  'billing:read', 'billing:write',
  'team:read', 'team:invite', 'team:manage',
  'settings:read', 'settings:write',
  'api_keys:manage',
  'tenant:delete',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  'products:read', 'models:read', 'ar:read', 'tryon:read',
  'connections:read', 'analytics:read', 'team:read', 'settings:read',
];

const EDITOR: Permission[] = [
  ...READ_ONLY,
  'products:write', 'models:write', 'models:publish',
  'ar:write', 'ar:publish', 'tryon:write',
];

const ADMIN: Permission[] = [
  ...EDITOR,
  'products:delete', 'connections:write', 'analytics:export',
  'billing:read', 'team:invite', 'team:manage', 'settings:write', 'api_keys:manage',
];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: ADMIN,
  editor: EDITOR,
  /** Numbers, not settings: an analyst can export but cannot change what is measured. */
  analyst: [...READ_ONLY, 'analytics:export'],
  viewer: READ_ONLY,
};

export function permissionsFor(role: MemberRole, custom?: readonly string[] | null): Set<Permission> {
  if (custom?.length) {
    const known = new Set<string>(PERMISSIONS);
    return new Set(custom.filter((p): p is Permission => known.has(p)));
  }
  return new Set(ROLE_PERMISSIONS[role]);
}

export function can(permissions: Set<Permission>, permission: Permission): boolean {
  return permissions.has(permission);
}
