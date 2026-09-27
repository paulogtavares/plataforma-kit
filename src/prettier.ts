/**
 * Configuração comum do Prettier para os módulos da plataforma.
 *   // prettier.config.js
 *   export { default } from "plataforma-kit/prettier";
 */
const configuracao = {
  printWidth: 120,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
} as const;

export default configuracao;
