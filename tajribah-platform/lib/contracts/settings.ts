/**
 * P1.25 — store settings: the contract shared by the API (validation) and the screen (types
 * and instant feedback). Saudi identity fields follow §11: blank until the merchant supplies
 * them, never invented, and checked against their real shape.
 *
 *  - **CR** (السجل التجاري): 10 digits, as the Ministry of Commerce issues them.
 *  - **VAT** (الرقم الضريبي, ZATCA TRN): 15 digits, first and last digit 3.
 *  - Arabic-Indic digits are folded before checking — a Saudi keyboard types them (U+0660…).
 *  - An empty string clears a field (null); `undefined` leaves it as it is.
 */
import { z } from 'zod';
import { foldDigits } from '../money';

const digits = (value: unknown) => (typeof value === 'string' ? foldDigits(value).replace(/[\s-]/g, '') : value);
const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value);

export const CR_NUMBER = z.preprocess(
  (v) => blankToNull(digits(v)),
  z.string().regex(/^\d{10}$/, 'a CR number is 10 digits').nullable(),
);

export const VAT_NUMBER = z.preprocess(
  (v) => blankToNull(digits(v)),
  z.string().regex(/^3\d{13}3$/, 'a VAT number is 15 digits, starting and ending with 3').nullable(),
);

const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable());

export const SettingsPatch = z.object({
  name: z.string().trim().min(1, 'the store needs a name').max(120).optional(),
  nameAr: text(120).optional(),
  crNumber: CR_NUMBER.optional(),
  vatNumber: VAT_NUMBER.optional(),
  nationalAddress: text(300).optional(),
  city: text(80).optional(),
  brandColor: z.preprocess(blankToNull, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #0B7A75').nullable()).optional(),
  buttonRadius: z.number().int().min(0).max(24).optional(),
  consentTextAr: text(200).optional(),
  consentTextEn: text(200).optional(),
}).strict();
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export type StoreSettings = {
  slug: string;
  name: string;
  nameAr: string | null;
  crNumber: string | null;
  vatNumber: string | null;
  nationalAddress: string | null;
  city: string | null;
  brandColor: string | null;
  buttonRadius: number;
  consentTextAr: string | null;
  consentTextEn: string | null;
};

/** What the AR button looks like until the merchant brands it. */
export const DEFAULT_BUTTON_RADIUS = 12;
