/**
 * A1 — admin console endpoints. Every one starts with `staffContextFor`: staff with two-step
 * sign-in, or 404/403. Reads here are not staff actions; changes (A4 onward) are logged.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson } from '@/server/core/http/api';
import { staffContextFor, staffTrail } from './access';
import { platformOverview } from './overview';
import { listStores, storeDetail } from './stores';
import { actOnStore } from './actions';
import { actOnPerson, listPeople, personDetail } from './users';
import { errors } from '@/server/core/errors/problem';

/** API-A00 — GET /api/admin/whoami: the console's own guard asks this first. */
export const whoamiHandler = route(async (request) => {
  const staff = await staffContextFor(request);
  return json({ email: staff.email, fullName: staff.fullName });
});

/** API-A01 — GET /api/admin/audit?store=: the staff trail, newest first. */
export const staffTrailHandler = route(async (request) => {
  await staffContextFor(request);
  const store = new URL(request.url).searchParams.get('store');
  const storeId = store && z.string().uuid().safeParse(store).success ? store : undefined;
  return json({ entries: await staffTrail({ storeId }) });
});

/** API-A02 — GET /api/admin/overview: the platform at a glance (A2, ADM-02). */
export const overviewHandler = route(async (request) => {
  await staffContextFor(request);
  return json(await platformOverview());
});

const STATUS = z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']);
const PLAN = z.enum(['starter', 'growth', 'pro', 'enterprise']);

/** API-A03 — GET /api/admin/stores?q=&status=&plan=&before=: every store, newest first (ADM-03). */
export const listStoresHandler = route(async (request) => {
  await staffContextFor(request);
  const params = new URL(request.url).searchParams;
  const status = STATUS.safeParse(params.get('status'));
  const plan = PLAN.safeParse(params.get('plan'));
  const before = z.string().uuid().safeParse(params.get('before'));
  return json(await listStores({
    q: params.get('q')?.slice(0, 100) ?? undefined,
    status: status.success ? status.data : undefined,
    plan: plan.success ? plan.data : undefined,
    before: before.success ? before.data : undefined,
  }));
});

/** API-A04 — GET /api/admin/stores/[id]: one store in depth (ADM-04…07). */
export const storeDetailHandler = route(async (request) => {
  const staff = await staffContextFor(request);
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('store');
  return json(await storeDetail(staff, id));
});

const ACTION = z.discriminatedUnion('type', [
  z.object({ type: z.literal('extend_trial'), days: z.number().int(), reason: z.string().max(500) }),
  z.object({ type: z.literal('suspend'), reason: z.string().max(500) }),
  z.object({ type: z.literal('restore'), reason: z.string().max(500) }),
  z.object({ type: z.literal('adjust_credits'), delta: z.number().int(), reason: z.string().max(500) }),
]);

/** API-A05 — POST /api/admin/stores/[id]/actions: extend a trial, suspend, restore, adjust credits (A4, ADM-08). */
export const storeActionHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const staff = await staffContextFor(request, config);
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('store');
  await actOnStore(staff, id, await readJson(request, ACTION));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-A06 — GET /api/admin/users?q=&before=: people, newest first (A5, ADM-11). */
export const listPeopleHandler = route(async (request) => {
  await staffContextFor(request);
  const params = new URL(request.url).searchParams;
  const before = z.string().uuid().safeParse(params.get('before'));
  return json(await listPeople({ q: params.get('q')?.slice(0, 100) ?? undefined, before: before.success ? before.data : undefined }));
});

/** API-A07 — GET /api/admin/users/[id]: one person, their stores and live sessions (ADM-12). */
export const personDetailHandler = route(async (request) => {
  await staffContextFor(request);
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('person');
  return json(await personDetail(id));
});

const PERSON_ACTION = z.object({ type: z.enum(['end_sessions', 'reset_two_factor']), reason: z.string().max(500) });

/** API-A08 — POST /api/admin/users/[id]/actions: end every session, or reset two-step sign-in (ADM-12). */
export const personActionHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const staff = await staffContextFor(request, config);
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('person');
  return json(await actOnPerson(staff, id, await readJson(request, PERSON_ACTION)));
});
