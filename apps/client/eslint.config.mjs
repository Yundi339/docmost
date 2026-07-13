import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/exhaustive-deps": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-useless-escape": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
    },
  },
  {
    files: [
      "src/features/editor/page-editor.tsx",
      "src/features/database/components/embedded-record-page-editor.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@hocuspocus/provider",
              importNames: [
                "HocuspocusProvider",
                "HocuspocusProviderWebsocket",
              ],
              message:
                "Use useCollaborationProvider() for provider lifecycle management.",
            },
            {
              name: "y-indexeddb",
              message:
                "Use useCollaborationProvider() for local collaboration persistence.",
            },
            {
              name: "yjs",
              message:
                "Use useCollaborationProvider() for collaboration documents.",
            },
          ],
        },
      ],
    },
  },
);
