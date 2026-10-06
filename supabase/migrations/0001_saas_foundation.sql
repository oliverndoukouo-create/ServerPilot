create table if not exists public.app_users (
  discord_user_id text primary key check (discord_user_id ~ '^[0-9]{17,20}$'),
  username text not null,
  global_name text,
  avatar_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  session_hash text not null unique check (length(session_hash) = 64),
  discord_user_id text not null references public.app_users(discord_user_id) on delete cascade,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  csrf_token_hash text not null check (length(csrf_token_hash) = 64),
  encryption_key_id text,
  token_expires_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (access_token_ciphertext is not null and encryption_key_id is not null)
);

create index if not exists oauth_sessions_user_expiry_idx
  on public.oauth_sessions (discord_user_id, expires_at)
  where revoked_at is null;

create table if not exists public.oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  return_path text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.guilds (
  discord_guild_id text primary key check (discord_guild_id ~ '^[0-9]{17,20}$'),
  name text not null,
  icon_hash text,
  owner_discord_user_id text check (owner_discord_user_id is null or owner_discord_user_id ~ '^[0-9]{17,20}$'),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guild_memberships (
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  discord_user_id text not null references public.app_users(discord_user_id) on delete cascade,
  permissions text not null,
  is_owner boolean not null default false,
  verified_at timestamptz not null,
  primary key (discord_guild_id, discord_user_id)
);

create index if not exists guild_memberships_user_idx
  on public.guild_memberships (discord_user_id, verified_at desc);

create table if not exists public.guild_configurations (
  discord_guild_id text primary key references public.guilds(discord_guild_id) on delete cascade,
  schema_version integer not null default 1 check (schema_version > 0),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  updated_by_discord_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_definitions (
  id text primary key check (length(id) between 1 and 100),
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  enabled boolean not null default false,
  schema_version integer not null default 1 check (schema_version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_by_discord_user_id text,
  updated_by_discord_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discord_guild_id, id)
);

create index if not exists automation_definitions_guild_enabled_idx
  on public.automation_definitions (discord_guild_id, enabled);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  discord_channel_id text,
  creator_discord_user_id text not null check (creator_discord_user_id ~ '^[0-9]{17,20}$'),
  closed_by_discord_user_id text,
  status text not null check (status in ('open', 'closed', 'deleted')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((status = 'open' and closed_at is null) or status <> 'open')
);

create unique index if not exists tickets_one_open_per_creator_idx
  on public.tickets (discord_guild_id, creator_discord_user_id)
  where status = 'open';
create index if not exists tickets_guild_status_opened_idx
  on public.tickets (discord_guild_id, status, opened_at desc);

create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  target_discord_user_id text not null check (target_discord_user_id ~ '^[0-9]{17,20}$'),
  moderator_discord_user_id text,
  action_type text not null check (action_type in ('warn', 'timeout', 'kick', 'ban')),
  reason text not null check (length(reason) between 1 and 2000),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 2419200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists moderation_cases_target_idx
  on public.moderation_cases (discord_guild_id, target_discord_user_id, created_at desc);
create index if not exists moderation_cases_guild_idx
  on public.moderation_cases (discord_guild_id, created_at desc);

create table if not exists public.welcome_configurations (
  discord_guild_id text primary key references public.guilds(discord_guild_id) on delete cascade,
  enabled boolean not null default false,
  channel_id text,
  message_template text not null default 'Welcome {user} to {server}!',
  updated_by_discord_user_id text,
  updated_at timestamptz not null default now(),
  check (not enabled or channel_id is not null),
  check (length(message_template) between 1 and 2000)
);

create table if not exists public.xp_configurations (
  discord_guild_id text primary key references public.guilds(discord_guild_id) on delete cascade,
  enabled boolean not null default false,
  xp_per_message integer not null default 10 check (xp_per_message between 1 and 100),
  cooldown_seconds integer not null default 60 check (cooldown_seconds between 5 and 86400),
  daily_xp_cap integer not null default 500 check (daily_xp_cap between 1 and 10000),
  updated_by_discord_user_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.member_xp (
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  total_xp bigint not null default 0 check (total_xp >= 0),
  last_awarded_at timestamptz,
  daily_window date not null default (timezone('UTC', now())::date),
  xp_awarded_today integer not null default 0 check (xp_awarded_today >= 0),
  updated_at timestamptz not null default now(),
  primary key (discord_guild_id, discord_user_id)
);

create index if not exists member_xp_leaderboard_idx
  on public.member_xp (discord_guild_id, total_xp desc, discord_user_id);

create table if not exists public.xp_activity_deduplication (
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  source_event_id text not null check (length(source_event_id) between 1 and 128),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  created_at timestamptz not null default now(),
  primary key (discord_guild_id, source_event_id)
);

create index if not exists xp_activity_deduplication_created_idx
  on public.xp_activity_deduplication (created_at);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  event_type text not null check (event_type in (
    'member_joined', 'member_left', 'message_activity', 'xp_awarded',
    'ticket_opened', 'ticket_closed', 'moderation_action'
  )),
  actor_discord_user_id text,
  event_version integer not null default 1 check (event_version > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists analytics_events_guild_time_idx
  on public.analytics_events (discord_guild_id, occurred_at desc);
create index if not exists analytics_events_guild_type_time_idx
  on public.analytics_events (discord_guild_id, event_type, occurred_at desc);

create table if not exists public.guild_analytics_daily (
  discord_guild_id text not null references public.guilds(discord_guild_id) on delete cascade,
  day date not null,
  member_count integer check (member_count is null or member_count >= 0),
  active_members integer not null default 0 check (active_members >= 0),
  message_count integer not null default 0 check (message_count >= 0),
  xp_awarded bigint not null default 0 check (xp_awarded >= 0),
  xp_active_members integer not null default 0 check (xp_active_members >= 0),
  updated_at timestamptz not null default now(),
  primary key (discord_guild_id, day)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  discord_guild_id text references public.guilds(discord_guild_id) on delete cascade,
  actor_discord_user_id text,
  action text not null check (length(action) between 1 and 120),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_guild_time_idx
  on public.audit_logs (discord_guild_id, created_at desc);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  discord_guild_id text references public.guilds(discord_guild_id) on delete cascade,
  discord_user_id text references public.app_users(discord_user_id) on delete cascade,
  plan_key text not null check (plan_key in ('free', 'pro', 'pro_plus')),
  status text not null check (status in (
    'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'inactive'
  )),
  provider text not null check (provider in ('stripe', 'manual')),
  provider_customer_id text,
  provider_subscription_id text unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(discord_guild_id, discord_user_id) = 1),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start)
);

create index if not exists subscriptions_guild_status_idx
  on public.subscriptions (discord_guild_id, status)
  where discord_guild_id is not null;
create index if not exists subscriptions_user_status_idx
  on public.subscriptions (discord_user_id, status)
  where discord_user_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

alter table public.app_users enable row level security;
alter table public.oauth_sessions enable row level security;
alter table public.oauth_states enable row level security;
alter table public.guilds enable row level security;
alter table public.guild_memberships enable row level security;
alter table public.guild_configurations enable row level security;
alter table public.automation_definitions enable row level security;
alter table public.tickets enable row level security;
alter table public.moderation_cases enable row level security;
alter table public.welcome_configurations enable row level security;
alter table public.xp_configurations enable row level security;
alter table public.member_xp enable row level security;
alter table public.xp_activity_deduplication enable row level security;
alter table public.analytics_events enable row level security;
alter table public.guild_analytics_daily enable row level security;
alter table public.audit_logs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on table
  public.app_users,
  public.oauth_sessions,
  public.oauth_states,
  public.guilds,
  public.guild_memberships,
  public.guild_configurations,
  public.automation_definitions,
  public.tickets,
  public.moderation_cases,
  public.welcome_configurations,
  public.xp_configurations,
  public.member_xp,
  public.xp_activity_deduplication,
  public.analytics_events,
  public.guild_analytics_daily,
  public.audit_logs,
  public.subscriptions,
  public.stripe_webhook_events
from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.award_message_xp(
  p_discord_guild_id text,
  p_discord_user_id text,
  p_source_event_id text,
  p_xp_amount integer,
  p_cooldown_seconds integer,
  p_daily_xp_cap integer
)
returns table (awarded boolean, total_xp bigint, xp_awarded_today integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_xp bigint;
  v_last_awarded_at timestamptz;
  v_daily_window date;
  v_daily_xp integer;
  v_amount integer;
  v_today date := timezone('UTC', now())::date;
begin
  if p_discord_guild_id is null
    or p_discord_user_id is null
    or p_source_event_id is null
    or p_xp_amount is null
    or p_cooldown_seconds is null
    or p_daily_xp_cap is null
    or p_discord_guild_id !~ '^[0-9]{17,20}$'
    or p_discord_user_id !~ '^[0-9]{17,20}$'
    or length(p_source_event_id) not between 1 and 128
    or p_xp_amount not between 1 and 100
    or p_cooldown_seconds not between 5 and 86400
    or p_daily_xp_cap not between 1 and 10000 then
    raise exception 'Invalid XP award input.' using errcode = '22023';
  end if;

  insert into public.member_xp (discord_guild_id, discord_user_id)
  values (p_discord_guild_id, p_discord_user_id)
  on conflict (discord_guild_id, discord_user_id) do nothing;

  select mx.total_xp, mx.last_awarded_at, mx.daily_window, mx.xp_awarded_today
    into v_total_xp, v_last_awarded_at, v_daily_window, v_daily_xp
    from public.member_xp as mx
    where mx.discord_guild_id = p_discord_guild_id
      and mx.discord_user_id = p_discord_user_id
    for update;

  insert into public.xp_activity_deduplication (
    discord_guild_id, source_event_id, discord_user_id
  ) values (
    p_discord_guild_id, p_source_event_id, p_discord_user_id
  ) on conflict do nothing;

  if not found then
    return query select false, v_total_xp,
      case when v_daily_window = v_today then v_daily_xp else 0 end;
    return;
  end if;

  if v_daily_window <> v_today then
    v_daily_xp := 0;
  end if;

  if v_last_awarded_at is not null
    and v_last_awarded_at > now() - make_interval(secs => p_cooldown_seconds) then
    update public.member_xp
      set daily_window = v_today,
          xp_awarded_today = v_daily_xp,
          updated_at = now()
      where discord_guild_id = p_discord_guild_id
        and discord_user_id = p_discord_user_id;
    return query select false, v_total_xp, v_daily_xp;
    return;
  end if;

  v_amount := least(p_xp_amount, p_daily_xp_cap - v_daily_xp);
  if v_amount <= 0 then
    update public.member_xp
      set daily_window = v_today,
          xp_awarded_today = v_daily_xp,
          updated_at = now()
      where discord_guild_id = p_discord_guild_id
        and discord_user_id = p_discord_user_id;
    return query select false, v_total_xp, v_daily_xp;
    return;
  end if;

  update public.member_xp
    set total_xp = total_xp + v_amount,
        last_awarded_at = clock_timestamp(),
        daily_window = v_today,
        xp_awarded_today = v_daily_xp + v_amount,
        updated_at = now()
    where discord_guild_id = p_discord_guild_id
      and discord_user_id = p_discord_user_id
    returning member_xp.total_xp, member_xp.xp_awarded_today
      into v_total_xp, v_daily_xp;

  return query select true, v_total_xp, v_daily_xp;
end;
$$;

revoke all on function public.award_message_xp(text, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.award_message_xp(text, text, text, integer, integer, integer)
  to service_role;
