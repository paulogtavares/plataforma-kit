import { defineConfig } from "vitest/config";

// os testes de banco sobem um PGlite em memória por arquivo (alguns segundos cada)
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000 } });
