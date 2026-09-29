import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output: the minified storefront widget (P1.16).
    "widget/dist/**",
    // Vendored third-party viewer files, served as they were published (public/vendor/README.md).
    "public/vendor/**",
    // Local tool output, never committed: wrangler's dev bundles and the test runner's build.
    ".wrangler/**",
    ".tests/**",
  ]),
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // P0.5 / T9: the RLS-bypassing handle. Mirrors ADMIN_ALLOWED and APP_ALLOWED in
    // server/core/tenancy/__tests__/admin-handle.test.ts — change both together.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "db/client.ts",
      "server/core/tenancy/tenant-db.ts",
      "server/core/tenancy/context.ts",
      "server/core/tenancy/rls.ts",
      "server/core/auth/session.ts",
      "server/modules/auth/service.ts",
      "server/modules/auth/two-factor.ts",
      "server/modules/billing/trial.ts",
      "server/modules/billing/coupons.ts",
      "server/modules/billing/notices.ts",
      "server/modules/admin/access.ts",
      "server/modules/admin/overview.ts",
      "server/modules/admin/stores.ts",
      "server/modules/admin/actions.ts",
      "server/modules/admin/users.ts",
      "server/modules/admin/plans.ts",
      "server/modules/admin/billing.ts",
      "server/modules/admin/operations.ts",
      "server/modules/admin/support.ts",
      "server/modules/admin/coupons.ts",
      "server/modules/admin/staff-view.ts",
      "server/modules/admin/privacy.ts",
      "server/modules/admin/retention.ts",
      "server/modules/admin/announcements.ts",
      "server/modules/admin/qa.ts",
      "server/modules/admin/ai-ops.ts",
      "server/core/jobs/queue.ts",
      "server/core/billing/entitlements.ts",
      "server/modules/webhooks/ingest.ts",
      "server/modules/webhooks/dispatch.ts",
      "server/modules/connections/rotation.ts",
      "server/modules/connections/health.ts",
      "server/modules/ai-jobs/guardrails.ts",
      "server/modules/ai-jobs/models.ts",
      "server/modules/admin/models.ts",
      "server/worker/passes.ts",
      "server/modules/api-keys/auth.ts",
      "server/modules/outgoing-webhooks/sweep.ts",
      "server/modules/models/cleanup.ts",
      "server/modules/ai-jobs/sweep.ts",
      "server/modules/sync/schedule.ts",
      "server/modules/team/service.ts",
      "server/testing/**",
      "**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/db/client",
          importNames: ["unsafeAdminDb", "appDb"],
          message: "Tenant data goes through withTenant() (server/core/tenancy/rls.ts). The admin handle bypasses row-level security — see docs/DECISIONS.md T9.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
