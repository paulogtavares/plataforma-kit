# plataforma-kit

Base comum dos módulos da plataforma (Cronogramas, Orçamentos, C.P): login local ou pelo portal, sessão,
permissões, erros e migrações. Extraído do Cronogramas v2.0.0.

O kit **não abre conexão com o banco**: cada módulo entrega o acesso (`Banco`) e decide onde estão os dados
(PostgreSQL, PGlite no servidor ou no navegador). Também não tem login por cabeçalho com id de usuário: isso é
coisa do modo navegador de cada módulo, nunca do servidor.

## Pontos de entrada

| Importação                    | Roda no navegador? | O que tem                                                                               |
| ----------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `plataforma-kit/erros`        | sim                | `ErroApi`, `proibido`, `naoEncontrado`, `traduzirErroPg(e, restricoesDoModulo)`         |
| `plataforma-kit/permissoes`   | sim                | `pode`, `criarCatalogo`, `chaveDoModulo`, `prefixar`, `exigirAdministrador`             |
| `plataforma-kit/sessao`       | sim                | `criarSessao` (`autenticar`, `carregarUsuario`), `lerCookie`, `hashToken`               |
| `plataforma-kit/portal`       | sim                | `verificarTokenPortal`, `assinarTokenPortal`, `validarSegredo`                          |
| `plataforma-kit/seguranca`    | não (node:crypto)  | senhas (scrypt), tokens, senha provisória, limite de tentativas                         |
| `plataforma-kit/autenticacao` | não                | rotas Fastify `/api/auth/entrar`, `/api/auth/sair`, `/api/eu`, `/api/auth/trocar-senha` |
| `plataforma-kit/migrador`     | não                | `migrar`: estrutura inicial num banco novo e migrações registradas                      |
| `plataforma-kit/tipos`        | sim                | `Banco`, `BancoComTransacao`, `UsuarioPlataforma`                                       |
| `plataforma-kit/eslint`       | — (ferramenta)     | `configuracaoEslint({ react, ignorar })`: configuração comum do ESLint 9                |
| `plataforma-kit/prettier`     | — (ferramenta)     | configuração comum do Prettier 3 (120 colunas, aspas duplas, vírgula final)             |

## Uso num módulo

```ts
import { criarSessao } from "plataforma-kit/sessao";
import { rotasAutenticacao } from "plataforma-kit/autenticacao";
import { criarCatalogo, pode } from "plataforma-kit/permissoes";

export const catalogo = criarCatalogo("orcamentos", [
  { chave: "orcamentos.ver", grupo: "Orçamentos", nome: "Ver orçamentos", descricao: "…" },
  { chave: "orcamentos.aprovar", grupo: "Orçamentos", nome: "Aprovar", descricao: "…" },
] as const);

const sessao = criarSessao({
  banco, // { query } do módulo
  todasPermissoes: catalogo.todas, // o que o administrador recebe
  modo: process.env.AUTH_MODO === "portal" ? "portal" : "local",
  nomeCookie: process.env.COOKIE_SESSAO ?? "orcamentos_sessao",
  portal: { segredo: process.env.PORTAL_SEGREDO!, emissor: process.env.PORTAL_EMISSOR },
});

app.addHook("onRequest", async (req) => {
  if (req.url.startsWith("/api/") && !req.routeOptions.config?.publica) req.usuario = await sessao.autenticar(req);
});
await app.register(rotasAutenticacao, { sessao, banco /* { query, tx } */, producao });

if (!pode(req.usuario, "orcamentos.aprovar")) throw proibido();
```

As tabelas esperadas são `usuarios`, `perfis` (com `permissoes text[]`) e `sessoes`, com as colunas usadas pelo
Cronogramas (ver `testes/apoio.ts` para o mínimo).

## Regra de nomes das permissões

Toda chave começa com o identificador do módulo e um ponto, seguido de um ou mais segmentos em minúsculas,
números ou `_`: `cronogramas.criar`, `cronogramas.modelos.gerenciar`, `orcamentos.aprovar`.
`criarCatalogo` recusa, ao iniciar, chaves fora da regra ou repetidas. Para renomear chaves antigas, use
`prefixar(modulo, chave)`, que é idempotente: `cronogramas.criar` continua `cronogramas.criar`, e `modelos.ver`
vira `cronogramas.modelos.ver`.

## Login

| `AUTH_MODO`      | Como funciona                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `local` (padrão) | E-mail e senha no módulo; sessão em cookie `HttpOnly; SameSite=Lax` (`Secure` em produção), validade de 7 dias renovada com o uso; bloqueio de 5 minutos após 5 erros; troca de senha provisória obrigatória |
| `portal`         | O portal autentica e repassa a requisição com um token no cabeçalho `X-Portal-Token`. Login por senha e troca de senha respondem que o acesso é pelo portal                                                  |

### Token do portal

JWT compacto assinado com **HS256** e um segredo compartilhado (`PORTAL_SEGREDO`, 32+ caracteres).

| Declaração | Obrigatória | Uso                                                        |
| ---------- | ----------- | ---------------------------------------------------------- |
| `email`    | sim         | e-mail do usuário, igual ao cadastrado no módulo           |
| `exp`      | sim         | validade em segundos (use tokens curtos, de minutos)       |
| `iat`      | não         | emissão (recusa token emitido no futuro)                   |
| `iss`      | não         | emissor; conferido quando o módulo define `PORTAL_EMISSOR` |

Recusa `alg` diferente de `HS256` (inclusive `none`), assinatura inválida, token expirado (folga de 60 s para
relógio) e usuário inativo ou não cadastrado. A tela recebe uma mensagem genérica; o motivo técnico vai para o log.

> Formato proposto pelo kit v1. Enquanto o portal não estiver pronto, os módulos rodam em `AUTH_MODO=local`.

## Lint e formatação

```js
// eslint.config.js
import { configuracaoEslint } from "plataforma-kit/eslint";
export default configuracaoEslint({ react: ["web/src/**/*.tsx"], ignorar: ["dist-pacote/**"] });

// prettier.config.js
export { default } from "plataforma-kit/prettier";
```

O ESLint foca em erros reais (hooks do React, variáveis não usadas, `==`), sem regras de estilo;
a formatação é do Prettier. Instale no módulo: `eslint @eslint/js typescript-eslint eslint-plugin-react-hooks
eslint-config-prettier globals prettier`.

## Desenvolvimento

```bash
npm run build -w plataforma-kit      # gera dist/ (roda sozinho no npm install da raiz)
npm test -w plataforma-kit           # testes com PGlite em memória, sem depender de nenhum módulo
```

O kit está no workspace `pacotes/plataforma-kit` do repositório do Cronogramas e foi montado para ser movido
para um repositório próprio sem mudanças (tem `package.json`, testes e `tsconfig` próprios).
