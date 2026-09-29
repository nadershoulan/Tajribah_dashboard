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

/**
 * P8 — what a custom role (Enterprise) may hold: the work — products, models, AR, try-on, analytics —
 * and seeing connections, the team and settings. Never the keys to the store: inviting or managing
 * people, changing settings, billing, API keys, store connections and deleting the store stay with
 * the owner and admins, so a custom role can never be a way to promote oneself.
 */
export const CUSTOM_ROLE_PERMISSIONS = [
  'products:read', 'products:write', 'products:delete',
  'models:read', 'models:write', 'models:publish',
  'ar:read', 'ar:write', 'ar:publish',
  'tryon:read', 'tryon:write',
  'analytics:read', 'analytics:export',
  'connections:read', 'team:read', 'settings:read',
] as const satisfies readonly Permission[];

export type CustomRolePermission = (typeof CUSTOM_ROLE_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<CustomRolePermission, { ar: string; en: string }> = {
  'products:read': { ar: 'رؤية المنتجات', en: 'See products' },
  'products:write': { ar: 'تعديل المنتجات', en: 'Edit products' },
  'products:delete': { ar: 'حذف المنتجات', en: 'Delete products' },
  'models:read': { ar: 'رؤية النماذج', en: 'See 3D models' },
  'models:write': { ar: 'رفع النماذج وتعديلها', en: 'Upload and edit 3D models' },
  'models:publish': { ar: 'نشر النماذج', en: 'Publish 3D models' },
  'ar:read': { ar: 'رؤية إعدادات العرض', en: 'See AR settings' },
  'ar:write': { ar: 'تعديل إعدادات العرض', en: 'Edit AR settings' },
  'ar:publish': { ar: 'نشر أزرار العرض', en: 'Publish AR buttons' },
  'tryon:read': { ar: 'رؤية التجربة الافتراضية', en: 'See virtual try-on' },
  'tryon:write': { ar: 'تعديل التجربة الافتراضية', en: 'Edit virtual try-on' },
  'analytics:read': { ar: 'رؤية التحليلات', en: 'See analytics' },
  'analytics:export': { ar: 'تصدير التحليلات', en: 'Export analytics' },
  'connections:read': { ar: 'رؤية ربط المتجر', en: 'See store connections' },
  'team:read': { ar: 'رؤية الفريق', en: 'See the team' },
  'settings:read': { ar: 'رؤية الإعدادات', en: 'See settings' },
};

/** Custom roles one store may define — a bound, not a price. */
export const MAX_CUSTOM_ROLES = 20;

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
