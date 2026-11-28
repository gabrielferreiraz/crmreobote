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
    "next-env.d.ts",
    // Não é código do CRM: rascunhos locais (gitignored), bibliotecas de OCR
    // minificadas copiadas para public/, protótipos HTML de design e scripts
    // CommonJS avulsos. Sem isso o lint acusava 48 "erros" falsos e deixava
    // de servir como verificação confiável.
    ".scratch/**",
    "public/ocr/**",
    "new-design-for-claude/**",
    "app/generated/**",
    "scripts/**/*.cjs",
  ]),
]);

export default eslintConfig;
