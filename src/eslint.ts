/**
 * Configuração comum do ESLint (flat config) para os módulos da plataforma.
 *   // eslint.config.js
 *   import { configuracaoEslint } from "@plataforma/kit/eslint";
 *   export default configuracaoEslint({ react: ["web/src/**"], ignorar: ["**\/dist/**"] });
 *
 * Foco em erros reais (hooks do React, variáveis não usadas, promessas esquecidas em código
 * síncrono), sem regras de estilo: a formatação fica com o Prettier.
 */
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export interface OpcoesEslint {
  /** padrões de arquivo com componentes React (liga as regras de hooks e os globais do navegador) */
  react?: string[];
  /** padrões ignorados, além de node_modules e dist */
  ignorar?: string[];
}

export function configuracaoEslint(o: OpcoesEslint = {}) {
  return tseslint.config(
    { ignores: ["**/node_modules/**", "**/dist/**", ...(o.ignorar ?? [])] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
      rules: {
        // o código usa "any" de propósito nas bordas (drivers de banco, erros de terceiros)
        "@typescript-eslint/no-explicit-any": "off",
        // "_" na frente marca parâmetro ou variável ignorada de propósito
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
        ],
        "no-empty": ["error", { allowEmptyCatch: true }],
        eqeqeq: ["error", "smart"],
        "prefer-const": "error",
      },
    },
    ...(o.react?.length
      ? [
          {
            files: o.react,
            languageOptions: { globals: { ...globals.browser } },
            // os tipos do plugin ainda não batem com os do typescript-eslint (sem efeito na execução)
            plugins: { "react-hooks": reactHooks as any },
            rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } as const,
          },
        ]
      : []),
    // desliga regras que brigariam com o Prettier (sempre por último)
    prettier,
  );
}
