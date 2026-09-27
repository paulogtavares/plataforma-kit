-- =====================================================================
-- plataforma-kit · identidade (perfis, usuários e sessões)
-- Exatamente as colunas que o kit lê e as restrições que ele traduz
-- (ux_usuarios_email, ck_admin_interno). Sem schema fixo: os objetos caem
-- no schema do módulo pelo search_path da conexão.
-- O migrador do kit aplica este arquivo num banco novo, ANTES da estrutura
-- do módulo. Colunas ou chaves próprias do módulo (ex.: usuarios.cliente_id
-- apontando para a tabela de clientes) vão em migração do módulo.
-- =====================================================================

DO $$
BEGIN
    IF to_regtype('tipo_usuario') IS NULL THEN
        CREATE TYPE tipo_usuario AS ENUM ('interno', 'externo');
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION fn_tg_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;

-- Perfis de acesso: conjunto de permissões do catálogo do módulo -------
CREATE TABLE IF NOT EXISTS perfis (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome           text NOT NULL,
    descricao      text,
    permissoes     text[] NOT NULL DEFAULT '{}',
    criado_em      timestamptz NOT NULL DEFAULT now(),
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_perfis_nome ON perfis (lower(nome));
DROP TRIGGER IF EXISTS tg_perfis_atualizado ON perfis;
CREATE TRIGGER tg_perfis_atualizado BEFORE UPDATE ON perfis
    FOR EACH ROW EXECUTE FUNCTION fn_tg_atualizado_em();

-- Usuários --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                  text NOT NULL,
    email                 text NOT NULL,
    tipo                  tipo_usuario NOT NULL DEFAULT 'interno',
    -- cliente do usuário externo; a chave estrangeira é do módulo (cada um tem a sua tabela de clientes)
    cliente_id            uuid,
    ativo                 boolean NOT NULL DEFAULT true,
    administrador         boolean NOT NULL DEFAULT false,
    perfil_id             uuid REFERENCES perfis (id) ON DELETE RESTRICT,
    senha_hash            text,
    precisa_trocar_senha  boolean NOT NULL DEFAULT true,
    ultimo_acesso         timestamptz,
    criado_em             timestamptz NOT NULL DEFAULT now(),
    atualizado_em         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_admin_interno CHECK (NOT administrador OR tipo = 'interno')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email ON usuarios (lower(email));
DROP TRIGGER IF EXISTS tg_usuarios_atualizado ON usuarios;
CREATE TRIGGER tg_usuarios_atualizado BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_tg_atualizado_em();

-- Sessões do modo local (o banco guarda só o hash do token) -------------
CREATE TABLE IF NOT EXISTS sessoes (
    token_hash  text PRIMARY KEY,
    usuario_id  uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    criada_em   timestamptz NOT NULL DEFAULT now(),
    expira_em   timestamptz NOT NULL,
    ip          text,
    agente      text
);
CREATE INDEX IF NOT EXISTS ix_sessoes_usuario ON sessoes (usuario_id);
CREATE INDEX IF NOT EXISTS ix_sessoes_expira ON sessoes (expira_em);
