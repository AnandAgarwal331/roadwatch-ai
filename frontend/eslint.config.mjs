import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// eslint-config-next 16 ships flat config directly, so the presets are spread
// in as-is and stay the source of truth when Next updates them.
export default [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "*.tsbuildinfo"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // A leftover import is nearly always a mistake; make it an error so it
      // cannot ride along into a build.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
