CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  nome text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('admin', 'comum')),
  ativo boolean NOT NULL DEFAULT true,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  ultimo_login_at timestamptz,
  tempo_logado_ms bigint NOT NULL DEFAULT 0 CHECK (tempo_logado_ms >= 0),
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE app_private.users FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.login_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_private.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('logout', 'expired', 'revoked', 'server_restart'))
);

CREATE INDEX IF NOT EXISTS login_sessions_user_started_idx
  ON app_private.login_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS login_sessions_open_idx
  ON app_private.login_sessions (last_seen_at)
  WHERE ended_at IS NULL;

REVOKE ALL ON TABLE app_private.login_sessions FROM PUBLIC;
