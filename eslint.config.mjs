import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next v16 ships native flat configs, so we import them directly.
// The old `FlatCompat.extends("next/core-web-vitals", "next/typescript")` wrapped
// the v16 *flat* config as if it were a legacy eslintrc config — that double-wrap
// re-entered eslint-plugin-react's self-referencing `configs.plugins.react`, and
// the legacy `@eslint/eslintrc` validator threw "Converting circular structure to
// JSON" before any rule (including react-hooks/rules-of-hooks) could run.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Nested `**/` forms matter: stale agent worktrees under `.claude/` carry
    // their own `.next/` build output, and a bare `.next/**` only matches root.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      ".claude/**",
      "app/themes.generated.css",
      "supabase/.temp/**",
    ],
  },
];

export default eslintConfig;
