/**
 * P1.1 — the onboarding state machine, as pure rules.
 *
 * A step is done because the database says so — an active connection, a product with
 * millimetre dimensions, a ready model, a widget event from the storefront — not because a
 * flag was set. A stored "connected ✓" drifts the moment a token is revoked; a fact does not.
 * Only steps with no fact behind them (`store`) are recorded, plus the merchant's skips.
 *
 * The order is the merchant journey (§3). Skipping is allowed only where the product still
 * works without the step: no plan yet (the trial continues) and no store connection
 * (products can be added by hand). Real size is the product, so `catalogue` cannot be skipped.
 */
import type { OnboardingState } from '@/db/schema';

export const STEPS = ['account', 'store', 'plan', 'connect', 'catalogue', 'first_model', 'embed'] as const;
export type StepKey = (typeof STEPS)[number];

export const SKIPPABLE: ReadonlySet<StepKey> = new Set<StepKey>(['plan', 'connect']);

/** What the database knows — gathered by the service, one boolean per fact. */
export type Facts = {
  storeConfirmed: boolean;
  hasPlan: boolean;
  hasActiveConnection: boolean;
  hasSizedProduct: boolean;
  hasReadyModel: boolean;
  widgetSeen: boolean;
};

export type StepState = { key: StepKey; done: boolean; skipped: boolean; current: boolean; skippable: boolean };

export type OnboardingView = { steps: StepState[]; current: StepKey | null; complete: boolean };

const FACT: Record<StepKey, (f: Facts) => boolean> = {
  account: () => true,
  store: (f) => f.storeConfirmed,
  plan: (f) => f.hasPlan,
  connect: (f) => f.hasActiveConnection,
  catalogue: (f) => f.hasSizedProduct,
  first_model: (f) => f.hasReadyModel,
  embed: (f) => f.widgetSeen,
};

/** The checklist as the merchant sees it. A skipped step whose fact later becomes true shows as done. */
export function evaluate(facts: Facts, state: OnboardingState | null | undefined): OnboardingView {
  const skipped = new Set(state?.skipped ?? []);
  let current: StepKey | null = null;
  const steps = STEPS.map((key) => {
    const done = FACT[key](facts);
    const isSkipped = !done && skipped.has(key) && SKIPPABLE.has(key);
    if (!done && !isSkipped && current === null) current = key;
    return { key, done, skipped: isSkipped, current: false, skippable: SKIPPABLE.has(key) };
  });
  for (const step of steps) step.current = step.key === current;
  return { steps, current, complete: current === null };
}

export class OnboardingError extends Error {}

/** Skip a step. Refused for a step the product cannot work without, and for a finished one. */
export function skip(state: OnboardingState | null | undefined, step: StepKey, facts: Facts): OnboardingState {
  if (!SKIPPABLE.has(step)) throw new OnboardingError(`"${step}" cannot be skipped`);
  if (FACT[step](facts)) throw new OnboardingError(`"${step}" is already done`);
  const next = normalise(state);
  if (!next.skipped!.includes(step)) next.skipped!.push(step);
  return withCurrent(next, facts);
}

/** Undo a skip — "actually, connect Salla now". */
export function unskip(state: OnboardingState | null | undefined, step: StepKey, facts: Facts): OnboardingState {
  const next = normalise(state);
  next.skipped = next.skipped!.filter((s) => s !== step);
  return withCurrent(next, facts);
}

/** The one step with no fact behind it: the merchant confirms the store's name and URL. */
export function confirmStore(state: OnboardingState | null | undefined, facts: Facts): OnboardingState {
  const next = normalise(state);
  if (!next.completedSteps.includes('store')) next.completedSteps.push('store');
  return withCurrent(next, { ...facts, storeConfirmed: true });
}

function normalise(state: OnboardingState | null | undefined): OnboardingState {
  return {
    step: state?.step ?? 'account',
    completedSteps: [...(state?.completedSteps ?? ['account'])],
    skipped: [...(state?.skipped ?? [])],
  };
}

/** Keep the stored `step` in line with the facts, so a reader of the raw row is not misled. */
function withCurrent(state: OnboardingState, facts: Facts): OnboardingState {
  const view = evaluate(facts, state);
  return { ...state, step: view.current ?? 'done' };
}

export function isStep(value: string): value is StepKey {
  return (STEPS as readonly string[]).includes(value);
}
