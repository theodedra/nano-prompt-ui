import globals from "globals";

export default [
  {
    ignores: ["lib/**"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // Chrome Extension APIs
        chrome: "readonly",
        // Chrome AI APIs (Built-in AI)
        LanguageModel: "readonly",
        Translator: "readonly",
        LanguageDetector: "readonly",
        Summarizer: "readonly",
        Rewriter: "readonly",
        // PDF.js globals
        pdfjsLib: "readonly",
        // Project globals (exported from modules)
        UI: "readonly",
        Model: "readonly",
        Controller: "readonly",
        Storage: "readonly",
        Toast: "readonly",
        Utils: "readonly",
        VirtualScroll: "readonly",
        PDFHandler: "readonly",
        Context: "readonly",
        AttachmentHandlers: "readonly",
        ChatHandlers: "readonly",
        ContextMenuHandlers: "readonly",
        SettingsHandlers: "readonly",
        SetupGuide: "readonly",
        CONSTANTS: "readonly"
      }
    },
    rules: {
      // Possible Errors
      "no-console": "off",
      "no-debugger": "warn",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-empty": "warn",
      "no-extra-semi": "error",
      "no-func-assign": "error",
      "no-irregular-whitespace": "error",
      "no-unreachable": "error",
      "no-unsafe-negation": "error",
      "valid-typeof": "error",

      // Best Practices
      "curly": ["warn", "multi-line"],
      "default-case": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-caller": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-loop-func": "warn",
      "no-multi-spaces": "warn",
      "no-new-wrappers": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-throw-literal": "warn",
      "no-unused-expressions": "warn",
      "no-useless-concat": "warn",
      "no-useless-escape": "warn",
      "no-with": "error",

      // Variables
      "no-delete-var": "error",
      "no-shadow-restricted-names": "error",
      "no-undef": "error",
      "no-unused-vars": ["warn", {
        "vars": "all",
        "args": "after-used",
        "ignoreRestSiblings": true
      }],
      "no-use-before-define": ["error", {
        "functions": false,
        "classes": true,
        "variables": true
      }],

      // Stylistic Issues
      "brace-style": ["warn", "1tbs", { "allowSingleLine": true }],
      "comma-dangle": ["warn", "never"],
      "comma-spacing": "warn",
      "comma-style": "warn",
      "eol-last": "warn",
      "key-spacing": "warn",
      "keyword-spacing": "warn",
      "no-mixed-spaces-and-tabs": "error",
      "no-multiple-empty-lines": ["warn", { "max": 2 }],
      "no-trailing-spaces": "warn",
      "semi": ["error", "always"],
      "semi-spacing": "warn",
      "space-before-blocks": "warn",
      "space-infix-ops": "warn"
    }
  }
];

