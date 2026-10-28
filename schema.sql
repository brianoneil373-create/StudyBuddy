-- StudyBuddy schema — paste into Supabase SQL Editor and run.
-- Dashboard: Project → SQL Editor → New query

-- ── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar text,
  level text,
  subjects text[] not null default '{}',
  topics text[] not null default '{}',
  bio text not null default '',
  streak integer not null default 0,
  status text not null default 'online'
    check (status in ('online', 'away', 'offline', 'studying', 'break')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── rooms ───────────────────────────────────────────────────────────────────
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  topic text not null default '',
  host_id uuid not null references public.profiles (id) on delete cascade,
  capacity integer not null default 6 check (capacity between 2 and 10),
  is_private boolean not null default false,
  ai_mode boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── messages ────────────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_room_created_idx on public.messages (room_id, created_at);

-- ── auto-create a profile when a user signs up ──────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar, level, subjects, topics)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data ->> 'display_name', new.email), 1)),
    new.raw_user_meta_data ->> 'level',
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'subjects')),
      '{}'
    ),
    coalesce(
      array(select jsonb_array_elements_text(new.raw_user_meta_data -> 'topics')),
      '{}'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ── row level security ──────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Public rooms are viewable; private rooms by host"
  on public.rooms for select
  to authenticated
  using (not is_private or host_id = auth.uid());

create policy "Authenticated users can create rooms"
  on public.rooms for insert
  to authenticated
  with check (host_id = auth.uid());

create policy "Hosts can update their rooms"
  on public.rooms for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

create policy "Hosts can delete their rooms"
  on public.rooms for delete
  to authenticated
  using (host_id = auth.uid());

create policy "Messages in visible rooms are readable"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.rooms r
      where r.id = room_id
        and (not r.is_private or r.host_id = auth.uid())
    )
  );

create policy "Users can send messages in visible rooms"
  on public.messages for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.rooms r
      where r.id = room_id
        and (not r.is_private or r.host_id = auth.uid())
    )
  );

-- ── realtime (room chat) ────────────────────────────────────────────────────
alter publication supabase_realtime add table public.messages;
