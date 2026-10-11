-- GAME LAB : exécuter ce fichier UNE SEULE FOIS dans Supabase > SQL Editor.
-- Toutes les modifications des données sont protégées par la connexion et l'appartenance au groupe.
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Notre GameLab' check (char_length(name) between 1 and 70),
  invite_code text not null unique default encode(gen_random_bytes(16),'hex'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create table if not exists public.room_games (
  room_id uuid not null references public.rooms(id) on delete cascade,
  game_id text not null check (char_length(game_id) between 1 and 80),
  name text not null check (char_length(name) between 1 and 90),
  appid bigint check (appid is null or appid > 0),
  genre text not null default 'Coop / À découvrir',
  players text not null default 'Multijoueur',
  description text not null default '' check (char_length(description) <= 700),
  image text not null default '',
  price_manual numeric(10,2) check (price_manual is null or price_manual >= 0),
  status text not null default 'todo' check (status in ('todo','playing','done')),
  fav boolean not null default false,
  sort_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(room_id,game_id)
);

-- Fonction de test d'appartenance, SECURITY DEFINER pour éviter les boucles RLS.
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = (select auth.uid()));
$$;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

-- Créer un groupe et devenir automatiquement membre.
create or replace function public.create_game_room(p_name text default 'Notre GameLab')
returns table(room_id uuid, code text)
language plpgsql security definer set search_path = '' as $$
declare v_room uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 1 and 70 then raise exception 'Nom invalide'; end if;
  insert into public.rooms(name,owner_id) values(trim(p_name),auth.uid()) returning id,invite_code into v_room,v_code;
  insert into public.room_members(room_id,user_id) values(v_room,auth.uid());
  return query select v_room,v_code;
end $$;
revoke all on function public.create_game_room(text) from public;
grant execute on function public.create_game_room(text) to authenticated;

-- Rejoindre via code difficile à deviner ; ne jamais publier ce code.
create or replace function public.join_game_room(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_room uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select r.id into v_room from public.rooms r where r.invite_code = lower(trim(p_code));
  if v_room is null then raise exception 'Code de groupe invalide'; end if;
  insert into public.room_members(room_id,user_id) values(v_room,auth.uid()) on conflict do nothing;
  return v_room;
end $$;
revoke all on function public.join_game_room(text) from public;
grant execute on function public.join_game_room(text) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_games enable row level security;

create policy "members view their rooms" on public.rooms for select to authenticated using (public.is_room_member(id));
create policy "members view memberships" on public.room_members for select to authenticated using (public.is_room_member(room_id));
create policy "members view games" on public.room_games for select to authenticated using (public.is_room_member(room_id));
create policy "members add games" on public.room_games for insert to authenticated with check (public.is_room_member(room_id));
create policy "members update games" on public.room_games for update to authenticated using (public.is_room_member(room_id)) with check (public.is_room_member(room_id));
create policy "members delete games" on public.room_games for delete to authenticated using (public.is_room_member(room_id));

-- Pour les notifications instantanées ; le site interroge aussi la base périodiquement.
do $$ begin
  alter publication supabase_realtime add table public.room_games;
exception when duplicate_object then null;
end $$;
