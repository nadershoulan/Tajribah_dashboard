/**
 * P6 — the model registry & A/B, for staff: the provider models each kind of AI work can use, how
 * new jobs are split among them, how each is doing, and the way back when one goes wrong.
 *
 *  - **A new model starts off** (inactive, 0%). Switched on beside others it takes 0% until staff
 *    give it a share; switched on alone it takes everything (otherwise nothing would run).
 *  - **Splits** are set for a job type all at once: every active model of that type, whole
 *    percents, adding up to 100. A model that is off cannot be given a share.
 *  - **Switching off or rolling back** a model gives its share back to the others in proportion
 *    (whole percents, still 100 in total); a rollback also records when. Jobs already running keep
 *    the model they were given.
 *  - Every change is written to the staff trail with its reason and the splits before and after.
 */
import { and, asc, eq } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { modelRegistry, AI_JOB_TYPE } from '@/db/schema';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { modelOutcomes, type ModelOutcomes, type RegistryModel } from '@/server/modules/ai-jobs/models';
import { uuidv7 } from '@/lib/ids';
import { staffLog, type StaffContext } from './access';

type AiJobType = (typeof AI_JOB_TYPE)[number];
const DAY = 86_400_000;

export type RegistryRow = {
  id: string; name: string; version: string; provider: string; endpoint: string | null; jobType: AiJobType | null;
  active: boolean; split: number; costPerCallCents: number; rolledBackAt: string | null; createdAt: string;
  outcomes: ModelOutcomes | null;
};

const rowOf = (m: RegistryModel, outcomes: Map<string, ModelOutcomes>): RegistryRow => ({
  id: m.id, name: m.name, version: m.version, provider: m.provider, endpoint: m.endpoint, jobType: m.jobType,
  active: m.isActive, split: m.abSplitPercent, costPerCallCents: m.costPerCallCents,
  rolledBackAt: m.rolledBackAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
  outcomes: outcomes.get(m.id) ?? null,
});

export async function listRegistry(days = 30, now = new Date()): Promise<RegistryRow[]> {
  const models = await unsafeAdminDb().select().from(modelRegistry).orderBy(asc(modelRegistry.jobType), asc(modelRegistry.name), asc(modelRegistry.version));
  const outcomes = await modelOutcomes(new Date(now.getTime() - days * DAY));
  return models.map((m) => rowOf(m, outcomes));
}

function why(reason: string): string {
  const text = reason.trim();
  if (text.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  return text;
}

export type NewModel = { name: string; version: string; provider: string; endpoint: string | null; jobType: string; costPerCallCents: number; reason: string };

export async function registerModel(staff: StaffContext, input: NewModel): Promise<RegistryRow> {
  const reason = why(input.reason);
  const fields: Record<string, string[]> = {};
  const text = (value: string, max: number) => value.trim().length >= 1 && value.trim().length <= max;
  if (!text(input.name, 80)) fields.name = ['1 to 80 characters'];
  if (!text(input.version, 40)) fields.version = ['1 to 40 characters'];
  if (!text(input.provider, 40)) fields.provider = ['1 to 40 characters'];
  if (!(AI_JOB_TYPE as readonly string[]).includes(input.jobType)) fields.jobType = ['not a kind of AI work'];
  if (input.endpoint !== null && !/^https:\/\/[^\s]+$/.test(input.endpoint.trim())) fields.endpoint = ['an https address, or none'];
  if (!Number.isInteger(input.costPerCallCents) || input.costPerCallCents < 0 || input.costPerCallCents > 1_000_000) fields.costPerCallCents = ['whole US cents, 0 or more'];
  if (Object.keys(fields).length) throw errors.validation(fields);
  const values = {
    id: uuidv7(), name: input.name.trim(), version: input.version.trim(), provider: input.provider.trim(),
    endpoint: input.endpoint?.trim() || null, jobType: input.jobType as AiJobType, costPerCallCents: input.costPerCallCents,
    isActive: false, abSplitPercent: 0,
  };
  try {
    await unsafeAdminDb().transaction(async (tx) => {
      await tx.insert(modelRegistry).values(values);
      await staffLog(staff, { action: 'ai.model.register', targetType: 'model_registry', targetId: values.id, reason, detail: { name: values.name, version: values.version, jobType: values.jobType } }, tx as unknown as Db);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.validation({ version: ['this name already has this version'] });
    throw error;
  }
  return (await listRegistry()).find((m) => m.id === values.id)!;
}

/** Whole percents in proportion to `weights`, adding up to exactly 100 (largest remainder). */
export function shares(weights: { id: string; weight: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!weights.length) return out;
  const total = weights.reduce((n, w) => n + w.weight, 0);
  const exact = weights.map((w) => ({ id: w.id, value: total > 0 ? (w.weight * 100) / total : 100 / weights.length }));
  const floors = exact.map((e) => ({ ...e, floor: Math.floor(e.value) }));
  let left = 100 - floors.reduce((n, f) => n + f.floor, 0);
  for (const f of [...floors].sort((a, b) => (b.value - b.floor) - (a.value - a.floor) || a.id.localeCompare(b.id))) {
    out.set(f.id, f.floor + (left > 0 ? 1 : 0));
    left -= 1;
  }
  return out;
}

async function modelsOf(db: Db, jobType: AiJobType): Promise<RegistryModel[]> {
  return db.select().from(modelRegistry).where(and(eq(modelRegistry.jobType, jobType), eq(modelRegistry.isActive, true)));
}

export async function setSplits(staff: StaffContext, input: { jobType: string; splits: { id: string; percent: number }[]; reason: string }): Promise<void> {
  const reason = why(input.reason);
  if (!(AI_JOB_TYPE as readonly string[]).includes(input.jobType)) throw errors.validation({ jobType: ['not a kind of AI work'] });
  const jobType = input.jobType as AiJobType;
  await unsafeAdminDb().transaction(async (tx) => {
    const db = tx as unknown as Db;
    const active = await modelsOf(db, jobType);
    const given = new Map(input.splits.map((s) => [s.id, s.percent]));
    const fields: Record<string, string[]> = {};
    if ([...given.keys()].some((id) => !active.some((m) => m.id === id))) fields.splits = ['only models that are on, of this kind of work, can take a share'];
    else if (active.some((m) => !given.has(m.id))) fields.splits = ['give every model that is on a share (0 is a share)'];
    else if ([...given.values()].some((p) => !Number.isInteger(p) || p < 0 || p > 100)) fields.splits = ['whole percents, 0 to 100'];
    else if ([...given.values()].reduce((n, p) => n + p, 0) !== 100) fields.splits = ['the shares must add up to 100'];
    if (Object.keys(fields).length) throw errors.validation(fields);
    for (const m of active) await tx.update(modelRegistry).set({ abSplitPercent: given.get(m.id)!, updatedAt: new Date() }).where(eq(modelRegistry.id, m.id));
    await staffLog(staff, {
      action: 'ai.model.splits', targetType: 'model_registry', targetId: null, reason,
      detail: { jobType, before: Object.fromEntries(active.map((m) => [m.id, m.abSplitPercent])), after: Object.fromEntries(given) },
    }, db);
  });
}

/**
 * Switch a model on or off, or roll it back (off, and when). Off: its share goes to the others in
 * proportion. On: 0% beside others, 100% when it is the only one.
 */
export async function setModelActive(staff: StaffContext, id: string, active: boolean, reason: string, rollback = false): Promise<void> {
  const text = why(reason);
  await unsafeAdminDb().transaction(async (tx) => {
    const db = tx as unknown as Db;
    const [model] = await tx.select().from(modelRegistry).where(eq(modelRegistry.id, id)).for('update');
    if (!model) throw errors.notFound('model');
    if (!model.jobType) throw errors.conflict('say which kind of AI work this model does before switching it on');
    if (active === model.isActive && !rollback) return;
    const others = (await modelsOf(db, model.jobType)).filter((m) => m.id !== id);
    const before = Object.fromEntries([model, ...others].map((m) => [m.id, m.abSplitPercent]));
    const now = new Date();
    if (active) {
      await tx.update(modelRegistry).set({ isActive: true, abSplitPercent: others.length ? 0 : 100, rolledBackAt: null, updatedAt: now }).where(eq(modelRegistry.id, id));
    } else {
      await tx.update(modelRegistry).set({ isActive: false, abSplitPercent: 0, ...(rollback ? { rolledBackAt: now } : {}), updatedAt: now }).where(eq(modelRegistry.id, id));
      const next = shares(others.map((m) => ({ id: m.id, weight: m.abSplitPercent })));
      for (const [otherId, percent] of next) await tx.update(modelRegistry).set({ abSplitPercent: percent, updatedAt: now }).where(eq(modelRegistry.id, otherId));
    }
    const after = Object.fromEntries((await tx.select().from(modelRegistry).where(eq(modelRegistry.jobType, model.jobType))).map((m) => [m.id, m.isActive ? m.abSplitPercent : 0]));
    await staffLog(staff, {
      action: rollback ? 'ai.model.rollback' : active ? 'ai.model.on' : 'ai.model.off', targetType: 'model_registry', targetId: id, reason: text,
      detail: { name: model.name, version: model.version, jobType: model.jobType, before, after },
    }, db);
  });
}
