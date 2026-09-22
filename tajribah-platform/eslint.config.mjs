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
      "server/core/jobs/queue.ts",
      "server/core/billing/entitlements.ts",
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
