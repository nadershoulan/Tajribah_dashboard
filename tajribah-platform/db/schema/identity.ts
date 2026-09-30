/**
 * §7.3 — identity and tenancy.
 *
 * `users` is global, not tenant-scoped: one person can belong to several stores, which is
 * what the tenant switcher is for. Tenancy lives in `tenant_memberships`. This is the one
 * table without a `tenant_id`, deliberately — it looks like a bug if you forget why.
 */
import { index, pgEnum, pgTable, text, uniqueIndex, integer, uuid } from 'drizzle-orm/pg-core';
import { bool, createdAt, deletedAt, json, pk, tenantId, timestamps, ts } from './_shared';
// One source for the role list: the dashboard reads it too, without importing the database.
import { MEMBER_ROLE } from '../../lib/permissions';

export const TENANT_STATUS = ['trial', 'active', 'past_due', 'suspended', 'cancelled'] as const;
export const PRODUCT_CATEGORY = ['jewelry', 'watch', 'eyewear', 'bag', 'apparel', 'furniture', 'other'] as const;
export const TENANT_GOAL = ['ar_viewer', 'virtual_tryon', 'ai_3d_models'] as const;

export const tenantStatus = pgEnum('tenant_status', TENANT_STATUS);
export const productCategory = pgEnum('product_category', PRODUCT_CATEGORY);
export const tenantGoal = pgEnum('tenant_goal', TENANT_GOAL);
export const memberRole = pgEnum('member_role', MEMBER_ROLE);
export const membershipStatus = pgEnum('membership_status', ['active', 'invited', 'suspended']);
export const localeEnum = pgEnum('locale', ['ar', 'en']);
export const actorType = pgEnum('actor_type', ['user', 'system', 'staff', 'api_key', 'webhook']);
/** `security_change` (0022, T47): ended because the account's security changed — two-step sign-in turned on. */
export const revokedReason = pgEnum('revoked_reason', ['logout', 'rotation_reuse', 'password_change', 'admin', 'expired', 'security_change']);
export const verificationPurpose = pgEnum('verification_purpose', ['email_verify', 'password_reset', 'phone_otp', 'email_change']);

export type TenantStatus = (typeof TENANT_STATUS)[number];
export { MEMBER_ROLE };
export type { MemberRole } from '../../lib/permissions';

export type OnboardingState = {
  step: 'account' | 'store' | 'plan' | 'connect' | 'catalogue' | 'first_model' | 'publish' | 'embed' | 'done';
  completedSteps: string[];
  skipped?: string[];
};

export const tenants = pgTable('tenants', {
  id: pk(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  status: tenantStatus('status').notNull().default('trial'),
  planId: uuid('plan_id'),
  trialEndsAt: ts('trial_ends_at'),
  country: text('country').notNull().default('SA'),
  timezone: text('timezone').notNull().default('Asia/Riyadh'),
  locale: localeEnum('locale').notNull().default('ar'),
  currency: text('currency').notNull().default('SAR'),
  // Saudi merchant identity (§11). Blank until the merchant supplies it — never invented.
  crNumber: text('cr_number'),
  vatNumber: text('vat_number'),
  nationalAddress: text('national_address'),
  city: text('city'),
  logoUrl: text('logo_url'),
  productCategory: productCategory('product_category'),
  goal: tenantGoal('goal'),
  onboardingState: json<OnboardingState>('onboarding_state'),
  ...timestamps(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('tenants_slug_unq').on(t.slug),
  index('tenants_status_idx').on(t.status),
]);

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: tenantId().primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  branding: json<{ primary?: string; logoUrl?: string; buttonRadius?: number }>('branding'),
  whiteLabel: bool('white_label').default(false),
  customDomain: text('custom_domain'),
  consentTextAr: text('consent_text_ar'),
  consentTextEn: text('consent_text_en'),
  notificationPrefs: json<Record<string, boolean>>('notification_prefs'),
  ...timestamps(),
});

export const users = pgTable('users', {
  id: pk(),
  email: text('email').notNull(),
  emailVerifiedAt: ts('email_verified_at'),
  phone: text('phone'),
  phoneVerifiedAt: ts('phone_verified_at'),
  /** `pbkdf2$sha256$<iterations>$<salt>$<hash>` — the algorithm travels with the hash (T3). */
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  locale: localeEnum('locale').notNull().default('ar'),
  avatarUrl: text('avatar_url'),
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpEnabled: bool('totp_enabled').default(false),
  backupCodesHash: json<string[]>('backup_codes_hash'),
  /** P1.2b: the last authenticator time step accepted — a code is never accepted twice. */
  totpLastStep: integer('totp_last_step'),
  lastLoginAt: ts('last_login_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  /** Tajribah staff. Grants access to the admin console, never to tenant data by itself. */
  isStaff: bool('is_staff').notNull().default(false),
  ...timestamps(),
  deletedAt: deletedAt(),
}, (t) => [uniqueIndex('users_email_unq').on(t.email)]);

/**
 * P8 — a store's own role (Enterprise): a name and a set of permissions from
 * `CUSTOM_ROLE_PERMISSIONS`. A member holding one keeps `role` = viewer underneath, so a store that
 * leaves the plan falls back to the least, never to more.
 */
export const customRoles = pgTable('custom_roles', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  permissions: json<string[]>('permissions').notNull(),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [index('custom_roles_tenant_idx').on(t.tenantId)]);

/**
 * P8 — single sign-on (Enterprise): the store's OpenID Connect identity provider. Sign-in with it
 * starts from the store's address, admits only people who are already members, and opens a session
 * locked to this store (`sessions.sso_tenant_id`). The client secret is sealed under ENCRYPTION_KEY,
 * bound to the row. `email_domains`, when set, are the only addresses the provider may assert.
 */
export const ssoConnections = pgTable('sso_connections', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  issuer: text('issuer').notNull(),
  clientId: text('client_id').notNull(),
  clientSecretEncrypted: text('client_secret_encrypted').notNull(),
  emailDomains: json<string[]>('email_domains').notNull(),
  enabled: bool('enabled').notNull().default(false),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [uniqueIndex('sso_connections_tenant_unq').on(t.tenantId)]);

/** P8 — a member's identity at the store's provider (issuer + subject), linked on their first SSO sign-in. */
export const ssoIdentities = pgTable('sso_identities', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sso_identities_subject_unq').on(t.tenantId, t.issuer, t.subject)]);

export const tenantMemberships = pgTable('tenant_memberships', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull().default('viewer'),
  /** P8: a custom role; when set (and the plan has `custom_roles`) it decides the permissions. */
  customRoleId: uuid('custom_role_id').references(() => customRoles.id),
  status: membershipStatus('status').notNull().default('active'),
  invitedBy: uuid('invited_by'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('memberships_tenant_user_unq').on(t.tenantId, t.userId),
  index('memberships_user_idx').on(t.userId),
]);

export const invitations = pgTable('invitations', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: memberRole('role').notNull().default('viewer'),
  /** Only the hash is stored; the raw token exists solely in the emailed link. */
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  invitedBy: uuid('invited_by').notNull(),
  ...timestamps(),
}, (t) => [
  index('invitations_tenant_idx').on(t.tenantId),
  uniqueIndex('invitations_token_unq').on(t.tokenHash),
]);

/**
 * A session is a refresh-token family. The tokens themselves live in `refresh_tokens`, one
 * row per issued token, so *any* previously issued token can be recognised when it is
 * replayed — not only the most recent one. Remembering a single previous hash catches the
 * impatient thief and misses the patient one.
 */
export const sessions = pgTable('sessions', {
  id: pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The tenant this session is currently acting for; the switcher changes it. */
  tenantId: uuid('tenant_id'),
  userAgent: text('user_agent'),
  /** Salted, not a bare SHA-256 — an unsalted IP hash de-identifies nothing (§13.6). */
  ipHash: text('ip_hash'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  revokedReason: revokedReason('revoked_reason'),
  lastSeenAt: ts('last_seen_at'),
  /** A4b (drizzle/0012): staff viewing `tenantId` read-only until then; null otherwise. */
  impersonatingUntil: ts('impersonating_until'),
  /** A4b: the store this staff session goes back to when the view ends. */
  impersonationReturnTenantId: uuid('impersonation_return_tenant_id'),
  /** P8: signed in through this store's single sign-on — the session acts for this store only. */
  ssoTenantId: uuid('sso_tenant_id'),
  createdAt: createdAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

/**
 * One row per refresh token ever issued for a session.
 *
 * Rotation marks the presented row used and inserts a successor. Presenting a row that is
 * already used is theft: the token was copied, and both copies are now in play. Every
 * session the user has is revoked at that point (§13.6).
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: pk(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Keyed HMAC of the token. The raw token exists only in the client's cookie. */
  tokenHash: text('token_hash').notNull(),
  usedAt: ts('used_at'),
  replacedById: uuid('replaced_by_id'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('refresh_tokens_hash_unq').on(t.tokenHash),
  index('refresh_tokens_session_idx').on(t.sessionId),
]);

/** Short-lived, single-use tokens: email verification, password reset, phone OTP. */
export const verificationTokens = pgTable('verification_tokens', {
  id: pk(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purpose: verificationPurpose('purpose').notNull(),
  /** Keyed HMAC, domain-separated per purpose — a plain SHA-256 of six digits is a lookup table (§13.6). */
  tokenHash: text('token_hash').notNull(),
  destination: text('destination'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
}, (t) => [
  index('verification_purpose_idx').on(t.purpose, t.tokenHash),
  index('verification_user_idx').on(t.userId),
]);

export const apiKeys = pgTable('api_keys', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** First 8 characters, shown in the UI so a key can be identified without revealing it. */
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: json<string[]>('scopes'),
  lastUsedAt: ts('last_used_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('api_keys_hash_unq').on(t.keyHash),
  index('api_keys_tenant_idx').on(t.tenantId),
]);

export const auditLogs = pgTable('audit_logs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id'),
  actorType: actorType('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  changes: json<{ before?: Record<string, unknown>; after?: Record<string, unknown> }>('changes'),
  ipHash: text('ip_hash'),
  requestId: text('request_id'),
  createdAt: createdAt(),
}, (t) => [
  index('audit_tenant_time_idx').on(t.tenantId, t.createdAt),
  index('audit_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
]);

/**
 * A1 (drizzle/0011) — what staff did in the admin console. Platform-wide, admin role only.
 * `storeId`, not `tenantId`: an action may concern no store, and this must not get a tenant policy.
 */
export const staffAudit = pgTable('staff_audit', {
  id: pk(),
  staffUserId: uuid('staff_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  storeId: uuid('store_id'),
  reason: text('reason'),
  detail: json<Record<string, unknown>>('detail'),
  requestId: text('request_id'),
  createdAt: createdAt(),
}, (t) => [
  index('staff_audit_time_idx').on(t.createdAt),
  index('staff_audit_store_idx').on(t.storeId, t.createdAt),
]);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type Session = typeof sessions.$inferSelect;
