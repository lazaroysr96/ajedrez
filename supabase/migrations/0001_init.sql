-- AJEDREZ · esquema inicial para Supabase (Postgres)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id             uuid primary key default gen_random_uuid(),
  white_id       text,
  white_name     text,
  black_id       text,
  black_name     text,
  fen            text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  turn           text not null default 'w',
  status         text not null default 'waiting',  -- waiting | active | finished
  result         text,                             -- white | black | draw | null
  winner_id      text,
  last_move_san  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists games_status_idx  on public.games (status);
create index if not exists games_created_idx on public.games (created_at desc);

-- ---------------------------------------------------------------------------
-- Movimientos
-- ---------------------------------------------------------------------------
create table if not exists public.moves (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games(id) on delete cascade,
  ply         int  not null,
  color       text not null,          -- w | b
  from_sq     text not null,
  to_sq       text not null,
  promotion   text,
  san         text not null,
  fen_after   text not null,
  created_at  timestamptz not null default now(),
  unique (game_id, ply)
);

create index if not exists moves_game_idx on public.moves (game_id, ply);

-- ---------------------------------------------------------------------------
-- Seguridad (RLS): lectura publica, escritura solo via service_role (servidor)
-- ---------------------------------------------------------------------------
alter table public.games enable row level security;
alter table public.moves enable row level security;

drop policy if exists "games_select_public" on public.games;
create policy "games_select_public" on public.games for select using (true);

drop policy if exists "moves_select_public" on public.moves;
create policy "moves_select_public" on public.moves for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.games to anon, authenticated;
grant select on public.moves to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: publicar cambios para que el frontend reciba actualizaciones
-- ---------------------------------------------------------------------------
alter table public.games replica identity full;
alter table public.moves replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'moves'
  ) then
    alter publication supabase_realtime add table public.moves;
  end if;
end $$;
