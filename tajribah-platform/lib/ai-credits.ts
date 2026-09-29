/**
 * T55 — what AI work costs in credits. One place, read by the server (which refuses any other
 * price) and every screen that states it; the website's help article is checked against it.
 *
 * 10 credits per 3D generation (Nader: "make it", 2026-09-29): a 3D generation is the most
 * expensive work credits pay for, so a text job (Arabic content enrichment, on every plan) can later
 * cost 1 without being priced like a model. On Pro's 200 monthly credits that is 20 new 3D models
 * a month. The monthly allowance per plan stays in the plan rows (admin console); this is the price
 * of one piece of work.
 */
export const CREDITS_PER_3D_GENERATION = 10;
