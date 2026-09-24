/**
 * P1.10 — what a merchant may change on a product, checked before it is sent.
 *
 * The API (server/modules/products/service.ts + lib/contracts/products.ts) is the authority
 * and re-checks everything; this gives the form its answers without a round trip, and lets
 * the demo source refuse what the real one would. Tests pin both to the same rules:
 *
 *  - Millimetres are > 0 and ≤ 3000 (3 m covers furniture; more is a unit mistake).
 *  - AR needs width **and** height — a 3D watch at the wrong scale is worse than none.
 *  - Arabic-Indic digits and the Arabic decimal separator are accepted and folded (§11).
 */
import { foldDigits } from './money';
import { isSized } from './product-list';
import type { ProductRow } from './view-models';

export const MAX_MM = 3000;

export type Dimensions = NonNullable<ProductRow['dimensions']>;
export type ProductEdit = {
  dimensions?: Dimensions | null;
  arEnabled?: boolean;
  productType?: ProductRow['productType'];
};
export type FieldErrors = Record<string, string[]>;

/** `''` → null (cleared); a number in range → that number; anything else → an error message. */
export function parseMm(text: string): { value: number | null } | { error: string } {
  const folded = foldDigits(text).replace(/\u066B/g, '.').replace(/,/g, '.').trim();
  if (folded === '') return { value: null };
  if (!/^\d+(\.\d+)?$/.test(folded)) return { error: 'numbers only, in millimetres' };
  const value = Number(folded);
  if (value <= 0) return { error: 'must be more than 0' };
  if (value > MAX_MM) return { error: 'is over 3 metres — check the unit (mm)' };
  return { value };
}

/** Why `edit` would be refused for `current`, per field — empty when it would be accepted. */
export function editErrors(current: ProductRow, edit: ProductEdit): FieldErrors {
  const errors: FieldErrors = {};
  const dimensions = edit.dimensions === undefined ? current.dimensions : edit.dimensions;
  for (const [key, value] of Object.entries(dimensions ?? {})) {
    if (typeof value !== 'number' || !(value > 0)) (errors[`dimensions.${key}`] ??= []).push('must be more than 0');
    else if (value > MAX_MM) (errors[`dimensions.${key}`] ??= []).push('is over 3 metres — check the unit (mm)');
  }
  const arOn = edit.arEnabled ?? current.arEnabled;
  if (arOn && !isSized({ dimensions })) {
    errors.arEnabled = ['needs the width and height in millimetres first — AR shows the real size'];
  }
  return errors;
}

/** The edit applied, as the API would return the row. */
export function applyEdit(current: ProductRow, edit: ProductEdit, now = new Date()): ProductRow {
  return {
    ...current,
    ...(edit.dimensions !== undefined ? { dimensions: edit.dimensions } : {}),
    ...(edit.arEnabled !== undefined ? { arEnabled: edit.arEnabled } : {}),
    ...(edit.productType !== undefined ? { productType: edit.productType } : {}),
    updatedAt: now.toISOString(),
  };
}
