import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Un mois abrégé diffère entre le serveur et Safari (`Sept` / `Sep` en `en-GB`) :
// écrit à la main, il lève l'erreur d'hydratation #418 sans que rien d'autre le
// signale. `formateurDate` de `src/lib/jour-paris.ts` est la seule porte d'entrée.
const MOIS_ABREGE = "Property[key.name='month'][value.value='short'], Property[key.name='dateStyle'][value.value='medium']";
const MESSAGE_MOIS_ABREGE = "Un mois abrégé passe par formateurDate (src/lib/jour-paris.ts).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `NewExpression[callee.property.name='DateTimeFormat'] > ObjectExpression > :matches(${MOIS_ABREGE})`,
          message: MESSAGE_MOIS_ABREGE,
        },
        {
          selector: `CallExpression[callee.property.name=/^toLocale(Date)?String$/] > ObjectExpression > :matches(${MOIS_ABREGE})`,
          message: MESSAGE_MOIS_ABREGE,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prototypes HTML jetables (skill /prototype) — pas du code applicatif.
    "mockups/**",
  ]),
]);

export default eslintConfig;
