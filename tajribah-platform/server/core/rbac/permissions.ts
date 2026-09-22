/**
 * P0.10 — permission enforcement.
 *
 * The table of who may do what is data, and lives in `lib/permissions.ts` so the dashboard
 * can read it without importing the database. This file is the half that throws.
 *
 * A denied write is **403**, not 404 — the caller is a member of the tenant, so the
 * resource's existence is not a secret from them. The 404-instead-of-403 rule is for
 * *other* tenants' rows, and it lives in `TenantDb`.
 */
import { errors } from '../errors/problem';
import type { Permission } from '@/lib/permissions';

export {
  MEMBER_ROLE, PERMISSIONS, ROLE_PERMISSIONS, can, permissionsFor,
  type MemberRole, type Permission,
} from '@/lib/permissions';

/** Throws 403 naming the permission, which is safe to show and useful in support. */
export function requirePermission(permissions: Set<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) throw errors.forbidden(`missing permission: ${permission}`);
}
