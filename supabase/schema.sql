create table if not exists public.wocchi_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"version":1,"events":[],"tasks":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.wocchi_data enable row level security;

create policy "Users can read their own Wocchi data"
  on public.wocchi_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own Wocchi data"
  on public.wocchi_data for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own Wocchi data"
  on public.wocchi_data for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.wocchi_data to authenticated;
