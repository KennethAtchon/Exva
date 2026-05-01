import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", ".vite", ".vite-build", "node_modules"],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message: "Read env via electron/main/config/env.ts, not process.env directly.",
        },
      ],
    },
  },
  {
    files: ["electron/main/config/env.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
