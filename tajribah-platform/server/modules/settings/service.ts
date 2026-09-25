/**
 * P1.25 — store settings: business identity (name, CR, VAT, national address), branding of
 * the AR button, and the shopper consent text.
 *
 * Two tables, one save: `tenants` holds the identity, `tenant_settings` the rest. Both are
 * written in one transaction with one audit row, so a save never lands half-applied. The
 * slug is shown but not editable here — it is in storefront snippets already installed.
 */
import { eq } from 'drizzle-orm';
import { tenants, tenantSettings } from '@/db/schema';
import { DEFAULT_BUTTON_RADIUS, SettingsPatch, type StoreSettings } from '@/lib/contracts/settings';
import { record } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';

const TENANT_FIELDS = ['name', 'nameAr', 'crNumber', 'vatNumber', 'nationalAddress', 'city'] as const;

export async function getSettings(ctx: TenantContext): Promise<StoreSettings> {
  ctx.require('settings:read');
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  const extra = await ctx.db.findOne(tenantSettings);
  return {
    slug: tenant.slug, name: tenant.name, nameAr: tenant.nameAr, crNumber: tenant.crNumber, vatNumber: tenant.vatNumber,
    nationalAddress: tenant.nationalAddress, city: tenant.city,
    brandColor: extra?.branding?.primary ?? null,
    buttonRadius: extra?.branding?.buttonRadius ?? DEFAULT_BUTTON_RADIUS,
    consentTextAr: extra?.consentTextAr ?? null, consentTextEn: extra?.consentTextEn ?? null,
  };
}

export async function updateSettings(ctx: TenantContext, input: unknown): Promise<StoreSettings> {
  ctx.require('settings:write');
  const parsed = SettingsPatch.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const patch = parsed.data;

  await withTenant(ctx.tenantId, async (db) => {
    const before = await db.requireById(tenants, ctx.tenantId);
    const tenantPatch = Object.fromEntries(TENANT_FIELDS.filter((k) => k in patch).map((k) => [k, patch[k]]));
    const after = Object.keys(tenantPatch).length ? await db.updateById(tenants, ctx.tenantId, tenantPatch) : before;

    const current = await db.findOne(tenantSettings);
    const branding = {
      ...(current?.branding ?? {}),
      ...('brandColor' in patch ? { primary: patch.brandColor ?? undefined } : {}),
      ...('buttonRadius' in patch ? { buttonRadius: patch.buttonRadius } : {}),
    };
    const settingsPatch = {
      branding,
      ...('consentTextAr' in patch ? { consentTextAr: patch.consentTextAr } : {}),
      ...('consentTextEn' in patch ? { consentTextEn: patch.consentTextEn } : {}),
    };
    const settingsAfter = current
      ? (await db.update(tenantSettings, eq(tenantSettings.tenantId, ctx.tenantId), settingsPatch))[0]
      : await db.insert(tenantSettings, { tenantId: ctx.tenantId, ...settingsPatch });

    await record(ctx, {
      action: 'update', resourceType: 'store_settings', resourceId: ctx.tenantId,
      before: { ...pick(before), branding: current?.branding ?? null, consentTextAr: current?.consentTextAr ?? null, consentTextEn: current?.consentTextEn ?? null },
      after: { ...pick(after), branding: settingsAfter.branding, consentTextAr: settingsAfter.consentTextAr, consentTextEn: settingsAfter.consentTextEn },
    }, db);
  });
  return getSettings(ctx);
}

const pick = (row: typeof tenants.$inferSelect) => Object.fromEntries(TENANT_FIELDS.map((k) => [k, row[k]]));
