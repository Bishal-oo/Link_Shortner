/**
 * Jest config for an ESM + TypeScript project.
 *
 * - `ts-jest/presets/default-esm` compiles TS as ES modules.
 * - moduleNameMapper resolves the "@/*" path alias to the real src/ source
 *   during tests (mirrors the alias in tsconfig.json).
 * - The `test` script runs jest with --experimental-vm-modules (see package.json)
 *   which is what enables ESM support inside Jest.
 */
/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/tests/**/*.test.ts"],
  // Integration tests talk to real Postgres/Redis, so give them room.
  testTimeout: 20000,
};
