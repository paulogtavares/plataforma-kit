# plataforma-kit — histórico

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
