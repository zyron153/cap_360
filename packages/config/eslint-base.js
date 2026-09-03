// Shared custom rule overrides — each app's own eslint.config.{js,mjs} composes its own
// recommended presets (typescript-eslint, eslint-config-next, ...) around this. Not a full flat
// config on its own since the two apps need different presets underneath it.
module.exports = {
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
