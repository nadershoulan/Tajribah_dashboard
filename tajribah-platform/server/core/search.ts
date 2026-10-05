/**
 * A search box's words as a LIKE pattern that matches them anywhere — and only them: `%` and `_` (and the
 * escape itself) are escaped, so "100%" or "_" is text, not a wildcard. One copy for every list that
 * searches (products, AR settings, try-on).
 */
export const likeContains = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
