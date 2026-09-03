// Delegates to each package's own lint/typecheck scripts rather than invoking eslint/tsc
// directly on the staged file list — tsc (and Next's `next lint`) need whole-program/whole-app
// context, not a handful of file paths, and turbo caches whatever isn't affected anyway. A
// function value tells lint-staged "run this fixed command", ignoring the file list it'd
// otherwise pass as arguments.
module.exports = {
  // Function commands run without a shell — no "&&" support — so each step is its own array entry.
  "apps/api/**/*.ts": () => ["pnpm --filter @cap/api lint", "pnpm --filter @cap/api typecheck"],
  "apps/web/**/*.{ts,tsx}": () => ["pnpm --filter @cap/web lint", "pnpm --filter @cap/web typecheck"],
  "packages/**/*.ts": () => "pnpm typecheck",
};
