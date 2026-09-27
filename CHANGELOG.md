# plataforma-kit — histórico

## 1.2.0 · 2026-09-27

Primeira versão publicada no repositório próprio (antes o kit era incubado em `pacotes/plataforma-kit` do
Cronogramas; o histórico e as tags `kit-v1.0.0` e `kit-v1.1.0` foram preservados com `git subtree split`).
Pedido pelo Cronogramas (v2.0.0) para liberar o Orçamentos e o C.P.

- Pacote renomeado para `plataforma-kit`, instalado por dependência git com tag (`github:infracommerce/plataforma-kit#v1.2.0`).
- **Contrato do portal**: token em `X-Plataforma-Token`, segredo `SEGREDO_PLATAFORMA`, `iss` = `portal`, `aud` = id do
  módulo, `sub`, `tipo` e `permissoes` obrigatórios; o usuário local é criado ou atualizado pelo `sub` (fase 2).
- **Ambiente** (`lerAmbiente`): `MODO_TESTE=1` é ignorado em nuvem (produção, Railway ou `DATABASE_URL` remota);
  `ambiente` informado como `producao` ou `local`; `HOST`, `DADOS_DIR` com nomes antigos por módulo.
- **Usuários de teste herdados** (`auditarUsuariosDeTeste`): bloqueados em produção, aviso nos demais ambientes.
- **Base de servidor** (`prepararServidor`, `servirFront`): cabeçalhos, rotas padrão, erros `{ erro, codigo }`, prefixo.
- **Peças de tela** (`plataforma-kit/web` e `tokens.css`): prefixo, cliente de API, modo embutido (`navegar`, `tema`,
  `rota-alterada`, `sessao-expirada`) e tokens comuns.

> Nota: estas peças foram escritas numa sessão paralela cujo código-fonte se perdeu antes de ser publicado. Esta versão
> foi reconstruída a partir do código compilado dessa sessão (pacote de 26/09 18:50) e de como o Cronogramas o usava,
> com testes novos para cada peça.

## 1.1.0 · 2026-09-26

- Configuração comum de lint e formatação: `plataforma-kit/eslint` (`configuracaoEslint`) e
  `plataforma-kit/prettier`. As ferramentas são dependências opcionais (`peerDependencies`).

## 1.0.0 · 2026-09-26

Primeira versão, extraída do Cronogramas (v2.0.0).

- Sessão com dois modos: `local` (cookie) e `portal` (token JWT HS256 no cabeçalho `X-Portal-Token`).
- Rotas de login do modo local: entrar, sair, quem sou eu, trocar senha.
- Segurança: senhas com scrypt, token de sessão guardado só como hash, limite de tentativas, senha provisória.
- Permissões: `pode()`, catálogo por módulo e regra de nomes `<módulo>.<recurso>[.<ação>]`, com `prefixar()`.
- Erros: `ErroApi` e tradução de erros do PostgreSQL com as mensagens de cada módulo.
- Migrador: estrutura inicial num banco novo e migrações registradas, cada uma numa transação.
- Não depende de conexão própria com o banco nem tem login por cabeçalho com id de usuário.
