/**
 * T69 — the website's own settings, for staff: today its GA4 measurement id, set here instead of a
 * build variable (NEXT_PUBLIC_GA_ID stays as the fallback). Pasted, or picked after signing in with
 * Google (`server/modules/google/ga4.ts`).
 *
 * A save writes `site_settings` and the website's copy in the config store (`_site/settings.json`,
 * served by the config host like a product's config — the website never reads Postgres). The config
 * store is written first: if the row's write then fails, the next save writes both again. Every
 * change is in the staff trail with its reason.
 */
import { eq } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { siteSettings } from '@/db/schema';
import { GA4_ID } from '@/lib/contracts/settings';
import { configStore } from '@/server/core/edge/configs';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from './access';

/** Where the website's settings live in the config store: `/v1/_site/settings.json` on the config host. No store's key starts with `_`. */
export const SITE_SETTINGS_KEY = '_site/settings.json';
const GA4_KEY = 'ga4_measurement_id';

export type SiteSettings = { ga4MeasurementId: string | null; updatedAt: string | null };
/** What the website reads. `v` is the shape's version, for a reader that meets a newer one. */
export type PublishedSiteSettings = { v: 1; ga4: string | null };

export async function siteSettingsForStaff(): Promise<SiteSettings> {
  const [row] = await unsafeAdminDb().select().from(siteSettings).where(eq(siteSettings.key, GA4_KEY)).limit(1);
  return { ga4MeasurementId: typeof row?.value === 'string' ? row.value : null, updatedAt: row?.updatedAt.toISOString() ?? null };
}

export async function updateSiteSettings(staff: StaffContext, input: { ga4MeasurementId: unknown; reason: string }, now = new Date()): Promise<SiteSettings> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  const parsed = GA4_ID.safeParse(input.ga4MeasurementId);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues.map((i) => ({ ...i, path: ['ga4MeasurementId'] }))));
  const id = parsed.data;

  const before = await siteSettingsForStaff();
  await configStore().put(SITE_SETTINGS_KEY, JSON.stringify({ v: 1, ga4: id } satisfies PublishedSiteSettings), now.getTime());
  await unsafeAdminDb().transaction(async (tx) => {
    if (id === null) await tx.delete(siteSettings).where(eq(siteSettings.key, GA4_KEY));
    else {
      await tx.insert(siteSettings).values({ key: GA4_KEY, value: id, updatedBy: staff.userId, updatedAt: now })
        .onConflictDoUpdate({ target: siteSettings.key, set: { value: id, updatedBy: staff.userId, updatedAt: now } });
    }
    await staffLog(staff, { action: 'site.ga4', targetType: 'site_settings', targetId: GA4_KEY, reason, detail: { before: before.ga4MeasurementId, after: id } }, tx as unknown as Db);
  });
  return siteSettingsForStaff();
}
