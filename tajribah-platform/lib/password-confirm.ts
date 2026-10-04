/**
 * The password typed twice — on sign-up and on a new password — so a typo does not lock the person
 * out of an account they just made. Checked in the browser only: the server never receives the copy.
 */
export const PASSWORDS_DIFFER = { ar: 'كلمتا المرور غير متطابقتين — اكتبها مرة أخرى.', en: 'The two passwords do not match — type it again.' };

/** Whether the confirmation stops the form: anything but an exact copy (an empty one included). */
export function passwordsDiffer(password: string, confirmation: string): boolean {
  return password !== confirmation;
}
