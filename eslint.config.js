import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".vite",
      ".vite-build",
      "node_modules",
      "e2e",
      "scripts",
      "playwright.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "no-console": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            "Read env via electron/main/config/env.ts, not process.env directly.",
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
  {
    files: [
      "electron/main/services/**/*.ts",
      "electron/main/ipc/**/*.ts",
      "electron/main/index.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "pino",
              message:
                "Use createLogger from electron/main/services/infra/log.ts instead of importing pino directly.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["electron/main/services/infra/log.ts", "electron/shared/logger.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
