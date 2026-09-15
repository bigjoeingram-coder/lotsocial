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
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    "sites-package-stage-*/**",
    "next-env.d.ts",
  ]),
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    ignores: ["app/chatgpt-auth.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='get'] > Literal[value=/^oai-/i]",
          message: "Read oai-* identity headers only inside requireAssociate() in app/chatgpt-auth.ts.",
        },
      ],
    },
  },
  // Pre-existing violations live in deferred I-17 UI refactor files; keep these rules enforced elsewhere.
  {
    files: [
      "app/approve/\\[token\\]/ApprovalForm.tsx",
      "app/components/AuthorizationApp.tsx",
      "app/provider/\\[token\\]/ProviderForm.tsx",
    ],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
]);

export default eslintConfig;
