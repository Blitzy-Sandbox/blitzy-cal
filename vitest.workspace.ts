import { defineWorkspace } from "vitest/config";

// Vitest 4.0 no longer allows custom CLI flags, so we use environment variables instead
// eslint-disable-next-line turbo/no-undeclared-env-vars
const packagedEmbedTestsOnly = process.env.VITEST_MODE === "packaged-embed";
// eslint-disable-next-line turbo/no-undeclared-env-vars
const timeZoneDependentTestsOnly = process.env.VITEST_MODE === "timezone";
// eslint-disable-next-line turbo/no-undeclared-env-vars
const integrationTestsOnly = process.env.VITEST_MODE === "integration";
// eslint-disable-next-line turbo/no-undeclared-env-vars
const envTZ = process.env.TZ;
if (timeZoneDependentTestsOnly && !envTZ) {
  throw new Error("TZ environment variable is not set");
}

// Use pool: "forks" to prevent "Closing rpc while fetch was pending" errors.
const pool = "forks" as const;

// Generous hook timeout to prevent beforeAll/beforeEach timeouts during full-suite
// runs where 633+ forked processes compete for CPU/memory, causing dynamic imports
// and mock setups to exceed the default 10 000 ms hook timeout.
// Observed slowdowns: 30–120× under full-suite contention (e.g. 3.5 s → 300+ s).
const hookTimeout = 600000;

// Generous test timeout matching the root vitest.config.mts value. Workspace projects
// do NOT inherit testTimeout from the root config, so it must be set explicitly.
// Under full-suite resource contention, individual tests performing dynamic imports
// (e.g., await import("../route")) can take 30–60 seconds instead of 2–3 seconds.
const testTimeout = 500000;

const workspaces = packagedEmbedTestsOnly
  ? [
      {
        test: {
          name: "PackagedEmbedTests",
          include: ["packages/embeds/**/packaged/**/*.{test,spec}.{ts,js}"],
          environment: "jsdom",
          pool,
          hookTimeout,
        },
      },
    ]
  : integrationTestsOnly
    ? [
        {
          test: {
            name: `IntegrationTests`,
            include: ["packages/**/*.integration-test.ts", "apps/**/*.integration-test.ts"],
            exclude: ["**/node_modules/**/*", "packages/embeds/**/*"],
            setupFiles: ["packages/testing/src/setupVitest.ts"],
            pool,
            hookTimeout,
          },
          resolve: {
            alias: {
              "~": new URL("./apps/api/v1", import.meta.url).pathname,
            },
          },
        },
      ]
    : // It doesn't seem to be possible to fake timezone per test, so we rerun the entire suite with different TZ. See https://github.com/vitest-dev/vitest/issues/1575#issuecomment-1439286286
  integrationTestsOnly
  ? [
      {
        test: {
          name: `IntegrationTests`,
          include: ["packages/**/*.integration-test.ts", "apps/**/*.integration-test.ts"],
          // TODO: Ignore the api until tests are fixed
          exclude: ["**/node_modules/**/*", "packages/embeds/**/*"],
          setupFiles: ["packages/testing/src/setupVitest.ts"],
        },
        resolve: {
          alias: {
            "~": new URL("./apps/api/v1", import.meta.url).pathname,
          },
        },
      },
    ]
  : timeZoneDependentTestsOnly
      ? [
          {
            test: {
              name: `TimezoneDependentTests:${envTZ}`,
              include: ["packages/**/*.timezone.test.ts", "apps/**/*.timezone.test.ts"],
              // TODO: Ignore the api until tests are fixed
              exclude: ["**/node_modules/**/*", "packages/embeds/**/*"],
              setupFiles: ["packages/testing/src/setupVitest.ts"],
              pool,
              hookTimeout,
            },
          },
        ]
      : [
          {
            test: {
              include: ["packages/**/*.{test,spec}.{ts,js}", "apps/**/*.{test,spec}.{ts,js}"],
              exclude: [
                "**/node_modules/**/*",
                "**/.next/**/*",
                "packages/embeds/**/*",
                "packages/lib/hooks/**/*",
                "packages/platform/**/*",
                "apps/api/v1/**/*",
                "apps/api/v2/**/*",
              ],
              name: "@calcom/lib",
              setupFiles: ["packages/testing/src/setupVitest.ts"],
              pool,
              hookTimeout,
              testTimeout,
            },
            resolve: {
              alias: {
                "@lib": new URL("./apps/web/lib", import.meta.url).pathname,
                "@server": new URL("./apps/web/server", import.meta.url).pathname,
                "@components": new URL("./apps/web/components", import.meta.url).pathname,
                "@pages": new URL("./apps/web/pages", import.meta.url).pathname,
                "~": new URL("./apps/web/modules", import.meta.url).pathname,
              },
            },
          },
          {
            test: {
              include: ["apps/api/v1/**/*.{test,spec}.{ts,js}"],
              exclude: [
                "**/node_modules/**/*",
                "**/.next/**/*",
                "packages/embeds/**/*",
                "packages/lib/hooks/**/*",
                "packages/platform/**/*",
                "apps/api/v2/**/*",
              ],
              name: "@calcom/api",
              setupFiles: ["packages/testing/src/setupVitest.ts"],
              pool,
              hookTimeout,
              testTimeout,
            },
            resolve: {
              alias: {
                "~": new URL("./apps/api/v1", import.meta.url).pathname,
              },
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/features",
              include: ["packages/features/**/*.{test,spec}.tsx"],
              exclude: ["packages/features/form-builder/**/*", "packages/features/bookings/**/*"],
              environment: "jsdom",
              setupFiles: ["setupVitest.ts", "packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },

          {
            test: {
              name: "@calcom/closecom",
              include: ["packages/app-store/closecom/**/*.{test,spec}.{ts,js}"],
              environment: "jsdom",
              setupFiles: ["packages/app-store/closecom/test/globals.ts"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/app-store-core",
              include: ["packages/app-store/*.{test,spec}.[jt]s?(x)"],
              exclude: ["packages/app-store/delegationCredential.test.ts"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/app-store-delegation-credential",
              include: ["packages/app-store/delegationCredential.test.ts"],
              environment: "node",
              setupFiles: ["packages/testing/src/setupVitest.ts"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/routing-forms",
              include: ["packages/app-store/routing-forms/**/*.test.tsx"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/ui",
              include: ["packages/ui/components/**/*.{test,spec}.[jt]s?(x)"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/features/form-builder",
              include: ["packages/features/form-builder/**/*.{test,spec}.[jt]sx"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/features/bookings",
              include: ["packages/features/bookings/**/*.{test,spec}.[jt]sx"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "@calcom/web/components",
              include: ["apps/web/components/**/*.{test,spec}.[jt]sx"],
              environment: "jsdom",
              setupFiles: ["packages/ui/components/test-setup.tsx"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              name: "EventTypeAppCardInterface components",
              include: ["packages/app-store/_components/**/*.{test,spec}.[jt]s?(x)"],
              environment: "jsdom",
              setupFiles: ["packages/app-store/test-setup.ts"],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              name: "@calcom/packages/lib/hooks",
              include: ["packages/lib/hooks/**/*.{test,spec}.{ts,js}"],
              environment: "jsdom",
              setupFiles: [],
              pool,
              hookTimeout,
            },
          },
          {
            test: {
              globals: true,
              environment: "jsdom",
              name: "@calcom/web/modules/views",
              include: ["apps/web/modules/**/*.{test,spec}.tsx"],
              setupFiles: ["apps/web/modules/test-setup.ts"],
              pool,
              hookTimeout,
            },
          },

          {
            test: {
              globals: true,
              environment: "jsdom",
              name: "@calcom/embeds",
              include: ["packages/embeds/**/*.{test,spec}.{ts,js}"],
              exclude: ["packages/embeds/**/packaged/**/*.{test,spec}.{ts,js}"],
              pool,
              hookTimeout,
            },
          },
        ];

export default defineWorkspace(workspaces);
