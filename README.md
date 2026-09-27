# plataforma-kit

Instalação em cada módulo, com versão fixa por tag (repositório privado da organização):

```json
"dependencies": { "plataforma-kit": "github:infracommerce/plataforma-kit#v1.3.0" }
```

O npm clona a tag e roda o `prepare`, que compila o `dist/`. Para atualizar, troque a tag e rode `npm install`.
Nunca edite a cópia dentro de `node_modules`: mudança no kit é sempre uma versão nova aqui, com tag e registro
no `CHANGELOG.md` (o que mudou e qual módulo pediu).

**Acesso ao repositório privado.** Quem instala a partir do código-fonte (desenvolvedores, CI) precisa de acesso
de leitura ao repositório no GitHub. O pacote de entrega dos módulos (`server.js` + `public/`) já leva o kit
compilado dentro, então o deploy do pacote no Railway **não** precisa de token. Só quem fizer o build no Railway a
partir do código-fonte precisa de um token do GitHub nas variáveis do serviço (alternativa aprovada: publicar no
GitHub Packages, sem mudar mais nada).

Base comum dos módulos da plataforma (Cronogramas, Orçamentos, C.P): login local ou pelo portal, sessão,
permissões, erros e migrações. Extraído do Cronogramas v2.0.0.

O kit **não abre conexão com o banco**: cada módulo entrega o acesso (`Banco`) e decide onde estão os dados
(PostgreSQL, PGlite no servidor ou no navegador). Também não tem login por cabeçalho com id de usuário: isso é
coisa do modo navegador de cada módulo, nunca do servidor.

## Pontos de entrada

| Importação                       | Roda no navegador? | O que tem                                                                                                                     |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `plataforma-kit/erros`           | sim                | `ErroApi`, `proibido`, `naoEncontrado`, `traduzirErroPg(e, restricoesDoModulo)`                                               |
| `plataforma-kit/permissoes`      | sim                | `pode`, `criarCatalogo`, `chaveDoModulo`, `prefixar`, `exigirAdministrador`                                                   |
| `plataforma-kit/sessao`          | sim                | `criarSessao` (`autenticar`, `carregarUsuario`), `lerCookie`, `hashToken`                                                     |
| `plataforma-kit/portal`          | sim                | `verificarTokenPlataforma`, `assinarTokenPlataforma`, `validarSegredo`, `CABECALHO_TOKEN`                                     |
| `plataforma-kit/seguranca`       | não (node:crypto)  | senhas (scrypt), tokens, senha provisória, limite de tentativas                                                               |
| `plataforma-kit/autenticacao`    | não                | rotas Fastify `/api/auth/entrar`, `/api/auth/sair`, `/api/eu`, `/api/auth/trocar-senha`                                       |
| `plataforma-kit/migrador`        | não                | `migrar`: identidade e estrutura num banco novo, migrações registradas                                                        |
| `plataforma-kit/identidade`      | não                | `scriptIdentidade`, `SQL_IDENTIDADE`, `descreverIdentidade` (arquivo em `sql/identidade.sql`)                                 |
| `plataforma-kit/administracao`   | não                | `rotasAdministracao`: `/api/admin/*` de usuários e perfis (exige administrador)                                               |
| `plataforma-kit/ambiente`        | não                | `lerAmbiente`, `lerAcesso`, `bancoEmNuvem`: produção/nuvem, `MODO_TESTE` (ignorado em nuvem), `HOST`, `DADOS_DIR`, login      |
| `plataforma-kit/usuariosTeste`   | não                | `auditarUsuariosDeTeste`: bloqueia em produção usuários de teste com a senha conhecida                                        |
| `plataforma-kit/servidor`        | não                | `prepararServidor` (cabeçalhos, `/api/saude`, `/api/status`, `/modulo.json`, login, erros com código), `servirFront`, prefixo |
| `plataforma-kit/web`             | sim                | `BASE`, `BASENAME`, `enderecoTela`, `criarClienteApi`, `ErroRequisicao`, `criarEmbutido`, `aplicarTema`                       |
| `plataforma-kit/react`           | sim (React)        | `ProvedorSessao`, `useSessao`, `TelaLogin`, `TelaTrocaSenha`, `Casca`, `TelaUsuarios`, `ProvedorAvisos`, `Modal`, `Campo`     |
| `plataforma-kit/tokens.css`      | sim                | cores, raio, sombra e fonte comuns (claro e escuro), casca e selos                                                            |
| `plataforma-kit/componentes.css` | sim                | estilos das peças de tela (importe depois de `tokens.css`)                                                                    |
| `plataforma-kit/identidade.sql`  | — (arquivo)        | o SQL de identidade, para quem quiser ler ou aplicar à mão                                                                    |
| `plataforma-kit/tipos`           | sim                | `Banco`, `BancoComTransacao`, `UsuarioPlataforma`                                                                             |
| `plataforma-kit/eslint`          | — (ferramenta)     | `configuracaoEslint({ react, ignorar })`: configuração comum do ESLint 9                                                      |
| `plataforma-kit/prettier`        | — (ferramenta)     | configuração comum do Prettier 3 (120 colunas, aspas duplas, vírgula final)                                                   |

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
  modulo: "orcamentos", // aud do token no modo portal
  segredoPlataforma: process.env.SEGREDO_PLATAFORMA,
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

### Token da plataforma (contrato do portal)

Com `AUTH_MODO=portal`, o portal repassa cada requisição com um JWT **HS256** no cabeçalho `X-Plataforma-Token`,
assinado com `SEGREDO_PLATAFORMA` (32+ caracteres, o mesmo no portal e nos módulos).

| Declaração                    | Obrigatória | Uso                                                                                   |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `iss`                         | sim         | `"portal"`                                                                            |
| `aud`                         | sim         | id do módulo (ou lista): token emitido para um módulo não vale em outro               |
| `sub`                         | sim         | id do usuário no portal (uuid); o módulo cria ou atualiza o usuário local com esse id |
| `email`, `tipo`               | sim         | e-mail e `interno`/`externo`                                                          |
| `permissoes`                  | sim         | chaves do módulo; as que não estão no catálogo são ignoradas                          |
| `exp`                         | sim         | poucos minutos (folga de 30 s para relógio); `iat` opcional                           |
| `nome`, `cliente_id`, `admin` | não         | `admin` só vale para `interno`                                                        |

Recusa `alg` diferente de `HS256` (inclusive `none`), assinatura inválida, token expirado e usuário desativado
no módulo. A tela recebe uma mensagem genérica; o motivo técnico vai para o log. No modo `local`, o cabeçalho é
ignorado.

### Modo embutido (tela dentro do portal)

`criarEmbutido({ modulo })` detecta o iframe e troca mensagens só com a mesma origem:
módulo → portal `rota-alterada` (`{ tipo, modulo, caminho, url, titulo }`) e `sessao-expirada`;
portal → módulo `navegar` (`{ caminho }`, sem recarregar) e `tema` (`claro`, `escuro` ou `sistema`).

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

## Identidade e administração (1.3.0)

As tabelas `perfis`, `usuarios` e `sessoes` vêm de `sql/identidade.sql`: exatamente as colunas que o kit lê e as
restrições que ele traduz (`ux_usuarios_email`, `ck_admin_interno`), sem schema fixo (caem no schema do módulo pelo
`search_path`). O migrador aplica o arquivo num banco novo **antes** da estrutura do módulo:

```ts
import { scriptIdentidade } from "plataforma-kit/identidade";
await migrar(motor, {
  tabelaReferencia: "orcamentos.orcamentos",
  identidade: scriptIdentidade(),
  base,
  migracoes,
  log,
});
```

Colunas ou chaves próprias do módulo (ex.: `usuarios.cliente_id → clientes`) vão em migração do módulo.
`descreverIdentidade(banco)` devolve a estrutura real em formato comparável, para testar que as tabelas do módulo são
iguais às do kit.

```ts
import { rotasAdministracao } from "plataforma-kit/administracao";
await app.register(rotasAdministracao, {
  banco,
  catalogo: catalogo.lista,
  permissaoInterna: "orcamentos.custos.ver", // opcional: perfil sem ela = usuário externo (não pode ser administrador)
  usuarios: { colunas: "c.nome AS cliente_nome", juncoes: "LEFT JOIN clientes c ON c.id = u.cliente_id" }, // opcional
});
```

## Peças de tela em React (1.3.0)

`react`, `react-router` e `lucide-react` são `peerDependencies`: o kit usa as versões instaladas no módulo (no Vite,
use `resolve.dedupe` para os três). Não há dependência de biblioteca de cache.

```tsx
import "plataforma-kit/tokens.css";
import "plataforma-kit/componentes.css";
import {
  Casca,
  ProvedorAvisos,
  ProvedorSessao,
  TelaLogin,
  TelaTrocaSenha,
  TelaUsuarios,
  useSessao,
} from "plataforma-kit/react";
import { BASENAME, criarClienteApi } from "plataforma-kit/web";

const cliente = criarClienteApi({
  aoExpirarSessao: () => window.dispatchEvent(new Event("orcamentos:sessao-expirada")),
});

function App() {
  const { usuario, carregando } = useSessao();
  if (carregando) return null;
  if (!usuario) return <TelaLogin subtitulo="Orçamentos" buscarStatus={() => cliente.get("/status")} />;
  if (usuario.precisa_trocar_senha) return <TelaTrocaSenha />;
  return (
    <>
      <Casca
        nome="Orçamentos"
        versao="2.0.0"
        data="2026-10-01"
        itensMenu={[{ rotulo: "Usuários e perfis", caminho: "/usuarios", somenteAdministrador: true }]}
      />
      <Routes>
        <Route path="/usuarios" element={<TelaUsuarios />} />
      </Routes>
    </>
  );
}

// <BrowserRouter basename={BASENAME}><ProvedorAvisos>
//   <ProvedorSessao cliente={cliente} eventoSessaoExpirada="orcamentos:sessao-expirada"><App /></ProvedorSessao>
// </ProvedorAvisos></BrowserRouter>
```

A `TelaUsuarios` é montada pelo catálogo do módulo e aceita extensões: botões no cabeçalho, detalhes na linha do
usuário e campos extras no formulário (`extensao`: estado inicial, componente, dados enviados e ação depois de salvar).
O Cronogramas usa esse ponto para o cliente do usuário externo e os cronogramas liberados.

## Desenvolvimento

```bash
npm run build -w plataforma-kit      # gera dist/ (roda sozinho no npm install da raiz)
npm test -w plataforma-kit           # testes com PGlite em memória, sem depender de nenhum módulo
```

O kit está no workspace `pacotes/plataforma-kit` do repositório do Cronogramas e foi montado para ser movido
para um repositório próprio sem mudanças (tem `package.json`, testes e `tsconfig` próprios).
