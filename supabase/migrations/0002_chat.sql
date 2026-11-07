-- AJEDREZ · Chat interno (E2E opcional)
-- Ejecutar en Supabase Dashboard → SQL Editor

-- 1. Tabla de mensajes
create table if not exists public.game_messages (
  id             bigint generated always as identity primary key,
  game_id        uuid not null references public.games(id) on delete cascade,
  player_id      text not null,              -- ajedrez.id / playerId
  player_name    text not null,
  content        text not null,              -- texto plano (v=0) o base64(ciphertext) (v=1)
  version        int not null default 0,     -- 0 = plano, 1 = libsodium crypto_box
  nonce          text,                       -- base64 nonce (solo v=1)
  created_at     timestamptz not null default now()
);

create index if not exists game_messages_game_idx on public.game_messages (game_id, created_at);

-- 2. Tabla de claves públicas para E2E (curve25519 / libsodium)
create table if not exists public.game_keys (
  game_id        uuid not null references public.games(id) on delete cascade,
  player_id      text not null,
  public_key     text not null,              -- base64(clave pública 32 bytes)
  created_at     timestamptz not null default now(),
  primary key (game_id, player_id)
);

-- 3. RLS: lectura pública, escritura solo vía service_role (servidor) o owner
alter table public.game_messages enable row level security;
alter table public.game_keys enable row level security;

drop policy if exists "game_messages_select_public" on public.game_messages;
create policy "game_messages_select_public" on public.game_messages
  for select using (true);

drop policy if exists "game_keys_select_public" on public.game_keys;
create policy "game_keys_select_public" on public.game_keys
  for select using (true);

-- Inserción la hace el servidor (service_role) o, si usas Supabase Auth,
-- podrías permitir insert con auth.uid() = player_id.
-- Aquí mantenemos service_role-only para insert/update/delete.

grant usage on schema public to anon, authenticated;
grant select on public.game_messages to anon, authenticated;
grant select on public.game_keys to anon, authenticated;

-- 4. Realtime
alter table public.game_messages replica identity full;
alter table public.game_keys replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_messages'
  ) then
    alter publication supabase_realtime add table public.game_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_keys'
  ) then
    alter publication supabase_realtime add table public.game_keys;
  end if;
end $$;

-- 5. Función helper para limpiar claves al borrar partida (opcional, cascada ya lo hace)
-- La FK ON DELETE CASCADE en game_messages y game_keys limpia automáticamente.