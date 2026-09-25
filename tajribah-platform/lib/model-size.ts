/**
 * The size a 3D model should come in under for AR to open quickly on a phone (§5) — one
 * number for the server's size report (P1.13) and the screens that show it (P1.14).
 * Binary megabytes, because `formatBytes` (lib/format.ts) displays sizes in them: a file
 * shown as "2 MB" must never be reported as over a "2 MB" target.
 */
export const MODEL_TARGET_BYTES = 2 * 1024 * 1024;
