module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.integration-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  testEnvironment: "node",
  // Real DB/Redis/HTTP round-trips need more headroom than mocked unit tests.
  testTimeout: 30_000,
};

// ponytail: --forceExit (in the test:integration script) papers over Bull's queue connections
// not being closed by app.close() in setup.ts — tests pass and print correctly, but the process
// otherwise hangs afterward ("Jest did not exit one second after the test run..."). Proper fix is
// closing each injected Queue in setup.ts's teardown; --forceExit first if that resurfaces as a
// real problem (e.g. it starts masking an actually-hanging test, not just idle connections).
