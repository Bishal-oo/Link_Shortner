/**
 * Jest config for an ESM + TypeScript project.
 *
 * - `ts-jest/presets/default-esm` compiles TS as ES modules.
 * - moduleNameMapper strips the ".js" from our NodeNext-style imports so Jest
 *   resolves "./app.js" to the real "./app.ts" source during tests.
 * - The `test` script runs jest with --experimental-vm-modules (see package.json)
 *   which is what enables ESM support inside Jest.
 */
/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testMatch: ["**/tests/**/*.test.ts"],
  // Integration tests talk to real Postgres/Redis, so give them room.
  testTimeout: 20000,
};
