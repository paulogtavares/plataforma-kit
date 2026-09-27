// Gera src/identidadeSql.ts a partir de sql/identidade.sql: o SQL vai junto no JavaScript,
// então funciona também quando o módulo empacota o servidor num arquivo só (esbuild).
import { readFileSync, writeFileSync } from "node:fs";
const sql = readFileSync(new URL("../sql/identidade.sql", import.meta.url), "utf8");
writeFileSync(
  new URL("../src/identidadeSql.ts", import.meta.url),
  `// GERADO por scripts/embutir-sql.mjs a partir de sql/identidade.sql. Não edite à mão.\nexport const SQL_IDENTIDADE = ${JSON.stringify(sql)};\n`,
);
