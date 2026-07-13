import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const STATIC_INLINE_STYLE_PROPS = new Set([
  "height",
  "width",
  "display",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "gap",
  "padding",
  "margin",
  "overflow",
  "cursor",
  "transition",
  "transformOrigin",
  "fontFamily",
  "whiteSpace",
  "userSelect",
  "pointerEvents",
]);

const themingPlugin = {
  rules: {
    "no-static-inline-styles": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow static inline style values when className should be used instead.",
        },
        schema: [],
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.name !== "style") return;
            if (node.value?.type !== "JSXExpressionContainer") return;
            if (node.value.expression.type !== "ObjectExpression") return;

            for (const property of node.value.expression.properties) {
              if (property.type !== "Property" || property.computed) continue;

              const keyName =
                property.key.type === "Identifier"
                  ? property.key.name
                  : property.key.type === "Literal" &&
                      typeof property.key.value === "string"
                    ? property.key.value
                    : null;

              if (!keyName || !STATIC_INLINE_STYLE_PROPS.has(keyName)) continue;

              const isStaticLiteral = property.value.type === "Literal";
              const isStaticTemplateLiteral =
                property.value.type === "TemplateLiteral" &&
                property.value.expressions.length === 0;

              if (!isStaticLiteral && !isStaticTemplateLiteral) continue;

              context.report({
                node: property.value,
                message:
                  "Move static style values to className; only computed values belong in style.",
              });
            }
          },
        };
      },
    },
    "no-arbitrary-token-escape": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow bg-[var(--…)] / text-[Npx] escape hatches; use registered Tailwind tokens.",
        },
        schema: [],
      },
      create(context) {
        const VAR_ESCAPE = /\[var\(--(?!radix)/;
        const TEXT_PX_ESCAPE = /(?:^|[\s"'`])text-\[[0-9]+px\]/;

        function checkLiteral(node, value) {
          if (typeof value !== "string") return;
          if (VAR_ESCAPE.test(value)) {
            context.report({
              node,
              message:
                "Use registered Tailwind colors (bg-surface, text-text2, …) instead of [var(--…)].",
            });
          } else if (TEXT_PX_ESCAPE.test(value)) {
            context.report({
              node,
              message:
                "Use named scale tokens (text-body, text-caption, …) instead of text-[Npx].",
            });
          }
        }

        return {
          Literal(node) {
            checkLiteral(node, node.value);
          },
          TemplateElement(node) {
            checkLiteral(node, node.value.raw);
          },
        };
      },
    },
  },
};

/** Files still on the pre-overhaul escape-hatch pattern — burn down by P8. */
const LEGACY_STYLE_FILES = ["src/components/sessions/SessionTable.tsx"];

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
      "tmp",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "react-hooks": reactHooks,
      theming: themingPlugin,
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
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Use a CSS var token from styles.css or a Tailwind semantic class. See THEMING.md.",
        },
        {
          selector: "TemplateElement[value.raw=/^#[0-9a-fA-F]{3,8}$/]",
          message:
            "Use a CSS var token from styles.css or a Tailwind semantic class. See THEMING.md.",
        },
      ],
      "theming/no-static-inline-styles": "error",
      "theming/no-arbitrary-token-escape": "error",
    },
  },
  {
    files: LEGACY_STYLE_FILES,
    rules: {
      "theming/no-arbitrary-token-escape": "off",
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
