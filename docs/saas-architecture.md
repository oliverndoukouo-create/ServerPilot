# ServerPilot SaaS Architecture

## Stage 1: current-state inspection

This document records the source architecture before SaaS changes. It was
prepared without opening `.env` or reading secret values.

### Current runtime

`src/index.ts` is both the Discord gateway entry point and the application
router. It creates the Discord client, dispatches slash commands and component
interactions directly to command modules, handles gateway events, and starts
automation execution. Discord-specific request/response handling and business
operations therefore share the same process and module boundaries.

Current functional areas:

| Area | Discord entry point | Business/data implementation | Current state |
|---|---|---|---|
| Setup / AI Server Builder | `src/commands/setup.ts` | `src/setup/*`, `src/ai/planner.ts`, `src/ai/provider.ts` | Plan, review, explicit confirmation, then Discord resource creation. Pending setup requests are process memory. |
| Automations | `src/commands/automation.ts` | `src/automation/engine.ts`, `src/automation/store.ts`, `src/ai/automation.ts` | Validated proposals and user confirmation; automation definitions are process memory. |
| Moderation / warnings | `src/commands/moderation.ts` | `src/automation/warnings.ts` | Discord moderation calls are present; warning history and log-channel configuration are process memory. |
| Tickets | `src/commands/tickets.ts` | Ticket workflow is implemented in the command module | Ticket settings, active tickets, and duplicate-open protection are process memory. |
| Welcome messages | `src/commands/welcome.ts` | Configuration and sending are in the command module | Welcome configuration is process memory. |
| Server information / health | `src/commands/server.ts`, `src/commands/ping.ts` | Discord.js guild/client objects | Read-only Discord-backed responses. |

There is no XP service, analytics pipeline, HTTP API, dashboard, Discord OAuth
flow, entitlement resolver, or Stripe integration in the current runtime.

### Persistence and configuration

The feature stores above use module-level `Map`/`Set` instances. They are lost
on restart, are not shared across bot instances, and have no repository
interface except the automation store's synchronous in-memory interface.

Before Stage 4, `src/db.ts` created a Supabase client at module load and threw
when server-side environment variables were absent. Stage 4 replaced that
behavior with an explicit lazy client factory; Supabase remains optional and
no current Discord workflow is silently switched to remote persistence.

`src/deploy-commands.ts` is a separate Discord command-registration utility.
`README.md` documents bot setup and optional AI configuration. No web
application or API process is defined in `package.json`.

### Security and ownership observations

- Discord commands use Discord's interaction permissions and, for sensitive
  setup actions, re-check guild context and bot permissions before mutation.
- AI proposals are treated as untrusted input and validated before preview or
  confirmation; the AI provider is not an action executor.
- There is no browser client or frontend-supplied guild ID in the current
  product, so dashboard authorization has not yet been implemented.
- A future dashboard must verify a user's Discord OAuth identity and current
  guild permissions server-side for every guild-scoped operation. A guild ID
  in a route or request body is only a requested resource, never proof of
  access.
- Bot tokens, OAuth credentials, database service credentials, and Stripe
  secrets must remain server-side. No secret values are recorded here.

### Baseline and migration constraints

Before SaaS changes, `npm test` passed (17 tests), `npm run typecheck` passed,
and `npm run build` passed.

The migration must preserve the existing Discord workflows and their
confirmation/permission boundaries. It should add business services and
repository ports incrementally, keep Discord.js at the adapter edge, avoid
requiring database credentials for the existing bot to start, and avoid
reporting persistence, dashboard, OAuth, billing, or XP capability until its
backing implementation is actually available.

## Stage 2: target architecture and data model

### Component architecture

```text
 Discord Gateway
       |
 Discord interaction/event adapters
       |
       +-------------------------------+
       |                               |
 ServerPilot application services      | (no Discord.js types)
       |                               |
 Repository ports                      | Discord API adapter
       |                               |
 Supabase/Postgres adapter             +----> Discord API
       |
 Postgres

 Browser dashboard
       |
 Same-origin HTTPS API
       |
 OAuth session -> authenticated principal
       |
 Guild authorization service -----> Discord OAuth guild permissions
       |
 Dashboard application services
       |
 Repository ports / Discord API adapter
       |
 Supabase/Postgres

 Billing provider port <---- future Stripe adapter/webhooks
       |
 Subscription repository -> server-owned entitlements
```

Discord interactions and the HTTP API are transport adapters. They validate
and translate inputs, then call shared application services. Services enforce
business rules and authorization through explicit ports; repositories own
storage concerns. Discord.js objects, HTTP request objects, and Supabase
clients must not leak into domain types. The first migration should extract
one feature at a time rather than replacing working command handlers wholesale.

The future dashboard is a same-origin browser application. It calls only the
ServerPilot API; it never receives a bot token, Supabase service credential,
Stripe secret, or authority to query Supabase directly. Until an API and its
backing service are implemented, the UI must show a clear unavailable/not-yet
connected state rather than fabricated data or successful writes.

### Relational data model

Discord snowflake identifiers are stored as text to avoid JavaScript integer
precision loss. Rows that belong to a guild carry a `guild_id` foreign key;
all repository methods and authorization checks scope reads and writes by that
guild. JSONB is reserved for versioned feature payloads whose shape changes
with the existing domain model; ownership, lifecycle, query, and relationship
fields remain relational.

| Table | Purpose and important fields |
|---|---|
| `app_users` | Discord subject ID (primary key), display metadata, created/updated timestamps. No bot token. |
| `oauth_sessions` | Hash of opaque session token, user ID, expiry/revocation timestamps, encrypted OAuth tokens and encryption key ID if retained. Tokens are never returned to the browser. |
| `oauth_states` | One-time hash of OAuth state, allow-listed return path, expiry and consumption timestamp. |
| `guilds` | Discord guild ID, current name/icon snapshot, Discord-reported owner ID, last synchronization time. A stored owner ID is not by itself authorization proof. |
| `guild_memberships` | `(guild_id, user_id)` key, last Discord-reported permission bitset, owner flag and verification timestamp. Snapshot for listing only; sensitive operations require a fresh server-side permission check. |
| `guild_configurations` | One row per guild; setup preferences and versioned ServerPilot configuration payload. |
| `automation_definitions` | UUID, guild ID, name, enabled state, validated trigger/condition/action JSONB, version, actor and timestamps. Continue to pass definitions through existing safety validation. |
| `tickets` | UUID, guild ID, creator/channel IDs, status, open/close timestamps, closer ID and optional metadata. Discord channel creation/deletion remains an adapter action. |
| `moderation_cases` | UUID, guild ID, target/moderator IDs, action type, reason, duration and timestamp. Warnings are cases with action type `WARN`; reads support warning counts. |
| `welcome_configurations` | Guild ID, enabled flag, channel ID, message template, updater and timestamp. |
| `xp_configurations` | Guild ID, enabled flag, XP amount, cooldown, per-day cap and configuration version. |
| `member_xp` | `(guild_id, user_id)` key, lifetime XP, level (or derived level), last-award time and daily-cap window state. Updates must be atomic. |
| `xp_activity_deduplication` | `(guild_id, source_event_id)` unique key to prevent duplicate gateway deliveries from awarding XP more than once. |
| `analytics_events` | Append-only guild-scoped event type/time plus privacy-reviewed, versioned metadata. Never store message bodies or OAuth tokens. |
| `guild_analytics_daily` | `(guild_id, day)` aggregate member count, active members, message count and XP activity; supports trend queries without exposing raw message content. |
| `audit_logs` | Guild ID, actor, action, entity type/ID, timestamp and redacted metadata for configuration, moderation, automation, access, and billing changes. |
| `subscriptions` | UUID, owner/user and/or guild subject, plan key, server-controlled provider/status IDs, period bounds and timestamps. Stripe identifiers are not authorization claims by themselves. |

Guild-scoped tables need database row-level security as defense in depth.
Browser clients do not connect using the service-role key. The backend uses a
server-only database adapter after authenticating and authorizing the request.
RLS does not replace the service-layer guild permission check. Migrations must
be additive, use explicit constraints/indexes, and must not seed pretend
subscription or analytics data.

### API surface (target)

All endpoints are same-origin, versioned under `/api/v1`, JSON, and deny by
default. `:guildId` is parsed as a Discord snowflake and then authorized against
the authenticated Discord user; it is never trusted because it came from the
browser.

| Route | Purpose |
|---|---|
| `GET /api/v1/health` | Process/configuration health only; no secret values. |
| `GET /api/v1/auth/discord` | Start OAuth authorization with one-time state and safe return path. |
| `GET /api/v1/auth/discord/callback` | Verify state, exchange code server-side, identify user and guild permissions. |
| `POST /api/v1/auth/logout` | Revoke server session and expire its secure cookie. |
| `GET /api/v1/me` | Authenticated user profile and session expiry. |
| `GET /api/v1/guilds` | Guilds the user currently manages where ServerPilot is installed. |
| `GET /api/v1/guilds/:guildId/overview` | Guild identity, member count and available-feature status. |
| `GET, PUT /api/v1/guilds/:guildId/settings` | Read/update validated configuration. |
| `POST /api/v1/guilds/:guildId/setup/plan` | Request a validated AI/deterministic plan. |
| `POST /api/v1/guilds/:guildId/setup/apply` | Apply only a reviewed plan after fresh authorization and bot-permission checks. |
| `GET, POST /api/v1/guilds/:guildId/automations` | List/create validated automation definitions. |
| `GET, PATCH, DELETE /api/v1/guilds/:guildId/automations/:automationId` | Inspect, update, enable/disable or delete a guild-scoped automation. |
| `GET /api/v1/guilds/:guildId/moderation/cases` | Permission-checked moderation history. |
| `POST /api/v1/guilds/:guildId/moderation/actions` | Validate permission, target hierarchy and bot capability before Discord action. |
| `GET, PUT /api/v1/guilds/:guildId/tickets/config` | Read/update ticket configuration. |
| `GET /api/v1/guilds/:guildId/tickets` | List tickets with pagination and guild scoping. |
| `GET, PUT /api/v1/guilds/:guildId/xp/config` | Read/update XP policy. |
| `GET /api/v1/guilds/:guildId/xp/leaderboard` | Paginated XP leaderboard. |
| `GET /api/v1/guilds/:guildId/analytics/summary` | Member, active-member, message and XP aggregates. |
| `GET /api/v1/guilds/:guildId/analytics/trends` | Bounded daily-series query for selected metrics/date window. |
| `GET /api/v1/guilds/:guildId/billing` | Server-controlled subscription and entitlement summary. |
| `POST /api/v1/guilds/:guildId/billing/checkout` | Future Stripe checkout port; unavailable until configured. |
| `POST /api/v1/webhooks/stripe` | Future verified, idempotent Stripe webhook adapter; unavailable until configured. |

Unsupported routes/features return an explicit `501`/unavailable response (or
are not mounted); they must not return a successful empty result that looks
like a working feature. API inputs require schema validation, request-size
limits, pagination bounds, safe error messages, rate limits, and audit events
for privileged mutations.

### Discord OAuth and guild authorization

1. The server creates a cryptographically random OAuth `state`, binds it to the
   browser session/start request, and validates it once on callback. Redirect
   destinations are allow-listed to prevent open redirects.
2. The OAuth code exchange and Discord API calls happen only on the backend.
   The browser receives only an opaque, `HttpOnly`, `Secure`, `SameSite=Lax`
   session cookie. Session IDs are random and stored hashed; logout revokes the
   server-side session. State-changing cookie-authenticated API requests also
   require CSRF protection and origin checks.
3. `/users/@me` establishes the Discord user ID. `/users/@me/guilds` is queried
   server-side to identify guilds where the user is owner, has `Manage Guild`,
   or has `Administrator`; do not trust guild IDs, permission flags, owner
   claims, or plan keys posted by the browser.
4. Guild access is checked on every guild-scoped operation, not only when the
   dashboard list loads. Refresh Discord permission evidence with a bounded,
   explicit freshness policy; fail closed when proof is expired/unavailable
   for a sensitive operation. Confirm ServerPilot is installed before offering
   Discord-mutating functions.
5. Use least-privilege OAuth scopes. Never place Discord bot credentials or
   database service credentials in a dashboard bundle, URL, or API response.

OAuth token retention is an implementation choice that must be explicit. If
refresh tokens must be retained, encrypt them with a separately managed key;
do not store raw tokens in ordinary session JSON or logs.

### Feature entitlements and billing boundary

Subscription state is read from the backend-owned subscription repository and
resolved by one entitlement service. Command handlers, API routes, and UI
components must ask that service for capabilities; they must not compare plan
names or accept a frontend-supplied tier. The resolver takes the effective
subscription status, plan key, feature catalog version, and guild/user
subject, then returns an immutable capability/limit snapshot.

Define the plan keys `free`, `pro`, and `pro_plus`, but keep the feature-to-tier
matrix and numeric quotas in one versioned policy module. Product limits and
pricing have not been specified; do not invent prices, advertise payment, or
silently restrict currently working Discord features. Until a policy is
approved and implemented, existing bot behavior remains unchanged and billing
UI must report that billing is not connected.

`BillingProvider` is a port for creating checkout sessions, verifying webhook
signatures, and retrieving subscription state. A future Stripe adapter owns
Stripe SDK usage. Webhooks must verify signatures, be idempotent by event ID,
handle out-of-order events, and update server-side subscription state only.
There are no Stripe credentials or configured Stripe capability implied by
this architecture.

### XP and Community Intelligence

The XP service consumes normalized activity events from a Discord adapter.
For V1, award only configured human guild message activity, with a minimum
activity interval per member/guild and a daily cap. Ignore bots, DMs, repeated
events, and messages that fail a minimal abuse filter; never store message
content. Make award updates atomic in the repository so multiple bot instances
cannot double-award during a cooldown race. Level is derived from lifetime XP
using one tested formula; rewards and role grants remain out of scope.

`AnalyticsEvent` is a privacy-reviewed domain event independent of Discord.js.
The ingestion service updates coarse daily aggregates for member count,
distinct active members, message activity, and XP awards. Retention and
aggregation policies must be explicit before production. Later Community
Intelligence consumes these metrics through stages:

```text
data -> diagnosis -> intelligence -> recommendation -> approved action
```

An insight/recommendation is not an action. Any future Discord mutation
requires explicit authorization, existing permission checks, and a human
confirmation boundary.

### Dashboard V1 structure

The dashboard is served by the same-origin API at `/` and uses the existing
OAuth-backed `/api/v1/me` and `/api/v1/guilds` endpoints. Its desktop sidebar
collapses into a horizontally navigable mobile menu. The server selector is
only a browser context: the API must re-check Discord guild permissions on
every future guild-scoped request. The current guild list includes no
fabricated member count or bot-installation state.

The shell provides Overview, Server selection, AI Assistant, Server Builder,
Automations, Moderation, Tickets, Members, XP/Levels, Community Intelligence,
Analytics, Notifications, Settings, and Billing. Dark, light, and system
themes are available; the choice persists in browser local storage. The
Overview reports insufficient data instead of inventing health scores or
metrics. Pages without implemented services are explicitly labelled “Coming
soon” or “Not connected”; the shell does not present fake forms or successful
actions. Static assets are served from a fixed allow-list with a restrictive
same-origin content security policy. `npm run build` copies those assets into
the build output.

### Implementation status for the definitive V1 stages

- **Stages 1–4 — inspection, architecture, boundaries, persistence readiness:**
  the current-state audit and target data model are documented above.
  Automation, welcome configuration, ticket configuration and lifecycle
  records, and moderation cases have repository/service boundaries with
  Supabase adapters and in-memory test/local adapters. The bot selects the
  Supabase implementations when database configuration is available. The
  migrations have not been confirmed as applied, and configured database
  connectivity has not been verified.
- **Stage 5 — dashboard shell:** implemented at `/` as a responsive same-origin
  UI with Overview, server selection, and clearly unavailable feature screens.
  It includes dark/light/system themes, profile presentation, session states,
  accessible navigation, restrictive content security policy, and build-time
  asset copying. Overview reports insufficient data rather than inventing
  metrics. The existing API provides health, body bounds, snowflake validation,
  injected authorization/service ports, and explicit `501` responses for
  missing services. Run locally with `npm run api`.
- **Stage 6 — OAuth and server selection:** the existing OAuth/session service
  and Supabase session repository implement one-use browser-bound state,
  encrypted provider tokens, hashed opaque sessions, refresh, CSRF/origin
  checks, and live Discord guild-permission verification. The dashboard uses
  `/api/v1/me` for username/display name/avatar, `/api/v1/guilds` for the
  manageable-server list, and the existing CSRF-protected logout. Each later
  guild-scoped API call must still perform its own authorization check.
  Required settings are `DISCORD_OAUTH_CLIENT_ID`,
  `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`,
  `DASHBOARD_PUBLIC_ORIGIN`, and a random 32-byte base64
  `DASHBOARD_TOKEN_ENCRYPTION_KEY`, in addition to server-only Supabase
  configuration. These values were not inspected or set. Tests use mocked
  Discord/repository adapters; live OAuth and database persistence have not
  been verified.
- **Stage 7 — connect existing ServerPilot functionality:** partially
  implemented. Every guild-scoped API request requires an authenticated user,
  validates the guild ID, and rechecks current Discord manage-guild access.
  Overview uses the authorized guild snapshot, approximate member count, and
  persisted automation/open-ticket counts when configured. Dashboard
  automations use the existing service for list/view/enable/disable and
  confirmed delete; create/edit remain in the existing validated Discord
  interaction flow. Welcome and ticket configuration are read through the
  same services as the bot. Ticket creation/closure now records guild-scoped
  lifecycle rows and the dashboard can list bounded ticket history; Discord
  channel permission checks and actions remain in the bot. Moderation history
  reads the existing case service; dashboard moderation actions remain
  unavailable. Server Builder uses the existing validated planner for preview
  only; applying a plan remains unavailable. No parallel feature engine or
  dashboard-authorized Discord mutation was added.
  Supabase-backed features require server-side database configuration and
  applied migrations; without a database, the bot uses the existing in-memory
  fallback and dashboard persistence-dependent endpoints explicitly report
  unavailable. No live Discord or database validation has been performed.
- **Stage 8 — Overview:** only the data-honest shell and explicit empty states
  exist. Persistent member/activity/health metrics and explainable health
  calculations are not implemented.
- **Stage 9 — Community Intelligence:** the data-to-diagnosis-to-recommendation
  architecture is documented; ingestion, baselines, prioritized insights,
  proposal validation, and confirmed actions are not implemented.
- **Stage 10 — XP and analytics:** schema foundations exist, but no runtime XP
  service, Discord event ingestion, aggregates, leaderboard, or analytics
  endpoints are implemented.
- **Stage 11 — subscription/entitlements:** plan concepts are documented, but
  there is no centralized feature-access resolver or approved quota matrix.
- **Stage 12 — Stripe:** not configured; no Stripe SDK, checkout, or webhook
  adapter is implemented.
- **Stages 13–14 — security/reliability audit and production readiness:**
  pending. Unit tests do not establish production readiness. Database
  migration execution, deployment behavior, monitoring, backups, rate limits,
  multi-instance OAuth behavior, and live Discord permissions still require
  validation.
