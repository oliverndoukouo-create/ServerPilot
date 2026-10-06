create table if not exists public.ticket_configurations (
  discord_guild_id text primary key references public.guilds(discord_guild_id) on delete cascade,
  category_id text not null check (category_id ~ '^[0-9]{17,20}$'),
  support_role_id text not null check (support_role_id ~ '^[0-9]{17,20}$'),
  log_channel_id text not null check (log_channel_id ~ '^[0-9]{17,20}$'),
  panel_channel_id text not null check (panel_channel_id ~ '^[0-9]{17,20}$'),
  enabled boolean not null default true,
  updated_by_discord_user_id text,
  updated_at timestamptz not null default now()
);

alter table public.ticket_configurations enable row level security;
revoke all on table public.ticket_configurations from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_configurations to service_role;
