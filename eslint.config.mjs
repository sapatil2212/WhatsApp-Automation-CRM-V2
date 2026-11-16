import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architectural guard rails.
 *
 * These rules are not style preferences — each one encodes a boundary that
 * was violated in the pre-refactor codebase and caused a production defect:
 *
 *  - The Supabase compatibility shims silently dropped query features
 *    (`select()` relations, `onConflict`, `.filter()`), which broke
 *    broadcasts, the flow runtime, and the inbox. Importing them again is
 *    an error.
 *  - `console.*` bypassed the structured logger, so failures had no
 *    requestId / tenantId and were untraceable.
 *  - Reaching for the unguarded Prisma client from a controller or
 *    repository defeats tenant isolation. Only the kernel and explicitly
 *    justified call sites may touch `systemDb`.
 *
 * `SHIM_MODULES` shrinks to zero as Task 1 progresses; the final commit of
 * Task 1 promotes the shim rule from `src/server/**` to the whole tree.
 */
const SHIM_MODULES = [
  {
    name: "@/lib/supabase/client",
    message:
      "Removed. Use the typed API client (src/lib/api-client) from the browser, or a service inside src/server.",
  },
  {
    name: "@/lib/supabase/server",
    message: "Removed. Use createHandler + a service/repository from src/server.",
  },
  {
    name: "@/lib/supabase/admin",
    message: "Removed. Use tenantDb() from @/server/kernel, or systemDb with a justification comment.",
  },
  {
    name: "@/lib/supabase/compat-client",
    message: "Removed. Use the typed API client (src/lib/api-client).",
  },
  {
    name: "@/lib/automations/admin-client",
    message: "Removed. Use tenantDb() from @/server/kernel.",
  },
  {
    name: "@/lib/flows/admin-client",
    message: "Removed. Use tenantDb() from @/server/kernel.",
  },
];

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
    // Throwaway diagnostic scripts, not part of the build.
    "scratch/**",
  ]),
  {
    // The new architecture holds itself to the full standard from day one.
    files: ["src/server/**/*.ts"],
    rules: {
      "no-console": "error",
      // `_`-prefixed parameters are intentionally unused — required when a
      // typed signature must be declared to satisfy an interface or to give
      // a test mock the right call shape.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...SHIM_MODULES,
            {
              name: "@/lib/prisma",
              message:
                "Use tenantDb()/systemDb from @/server/kernel so tenant isolation is enforced centrally.",
            },
          ],
        },
      ],
    },
  },
  {
    // Kernel internals legitimately construct the raw client and are the
    // one place allowed to import @prisma/client directly.
    files: ["src/server/kernel/db.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/server/**/*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
]);

export default eslintConfig;
