const pages = [
  { id: 'overview', label: 'Overview', description: 'See what is known about your selected community without inventing missing metrics.' },
  { id: 'servers', label: 'Server selection', description: 'Choose a Discord server you are currently allowed to manage.' },
  { id: 'assistant', label: 'AI Assistant', description: 'A server-aware assistant will use authorized community context and propose reviewed actions.' },
  { id: 'builder', label: 'Server Builder', description: 'Generate a structured plan through the existing ServerPilot planner. Dashboard application of the plan is not yet available.' },
  { id: 'automations', label: 'Automations', description: 'Inspect automations used by the existing ServerPilot engine. Changes are guild-scoped and destructive operations require confirmation.' },
  { id: 'moderation', label: 'Moderation', description: 'Review guild-scoped moderation cases recorded by ServerPilot. Destructive actions remain in permission-checked Discord commands.' },
  { id: 'tickets', label: 'Tickets', description: 'Inspect configuration and ticket lifecycle records from the existing ticket workflow. Discord channel actions remain in the bot.' },
  { id: 'members', label: 'Members', description: 'Member activity and management data are not yet available from a dashboard service.' },
  { id: 'xp', label: 'XP & Levels', description: 'XP persistence and leaderboard services are not yet connected.' },
  { id: 'intelligence', label: 'Community Intelligence', description: 'Insights will require real history, diagnosis, and validated recommendations.' },
  { id: 'analytics', label: 'Analytics', description: 'No persisted analytics ingestion or aggregation service is connected yet.' },
  { id: 'notifications', label: 'Notifications', description: 'Useful server alerts are not connected to a notification service yet.' },
  { id: 'settings', label: 'Settings', description: 'Inspect configuration stored by the existing ServerPilot services.' },
  { id: 'billing', label: 'Billing', description: 'Billing is not connected. No subscription or payment state is being inferred.' },
];

const state = {
  user: undefined,
  guilds: [],
  selectedGuildId: undefined,
  currentPage: 'overview',
  health: undefined,
  overview: undefined,
  automations: undefined,
  guildDataError: undefined,
  welcomeConfiguration: undefined,
  welcomeError: undefined,
  ticketConfiguration: undefined,
  ticketConfigurationError: undefined,
  tickets: undefined,
  ticketRecordsError: undefined,
  moderationCases: undefined,
  moderationError: undefined,
  setupPlan: undefined,
  setupPlanError: undefined,
};

const elements = {
  loading: document.querySelector('#loading-state'),
  auth: document.querySelector('#auth-state'),
  authMessage: document.querySelector('#auth-message'),
  authError: document.querySelector('#auth-error'),
  authRetry: document.querySelector('#auth-retry'),
  login: document.querySelector('#login-link'),
  dashboard: document.querySelector('#dashboard'),
  serverSelect: document.querySelector('#server-select'),
  profile: document.querySelector('#profile'),
  logout: document.querySelector('#logout-button'),
  theme: document.querySelector('#theme-select'),
  nav: document.querySelector('#primary-nav'),
  heading: document.querySelector('#page-heading'),
  content: document.querySelector('#page-content'),
  feedback: document.querySelector('#app-feedback'),
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `Request failed with status ${status}.`);
    this.status = status;
    this.code = code;
  }
}

async function loadSelectedGuildData() {
  const guild = currentGuild();
  state.overview = undefined;
  state.automations = undefined;
  state.guildDataError = undefined;
  state.welcomeConfiguration = undefined;
  state.welcomeError = undefined;
  state.ticketConfiguration = undefined;
  state.ticketConfigurationError = undefined;
  state.tickets = undefined;
  state.ticketRecordsError = undefined;
  state.moderationCases = undefined;
  state.moderationError = undefined;
  renderPage();
  if (!guild) return;
  const base = `/api/v1/guilds/${encodeURIComponent(guild.id)}`;
  try {
    const [overviewResult, automationResult, welcomeResult, ticketResult, ticketsResult, moderationResult] = await Promise.allSettled([
      api(`${base}/overview`),
      api(`${base}/automations`),
      api(`${base}/welcome/config`),
      api(`${base}/tickets/config`),
      api(`${base}/tickets?limit=50`),
      api(`${base}/moderation/cases`),
    ]);
    if (state.selectedGuildId !== guild.id) return;
    if (overviewResult.status === 'rejected') throw overviewResult.reason;
    if (automationResult.status === 'rejected') throw automationResult.reason;
    state.overview = overviewResult.value;
    state.automations = automationResult.value.automations;
    if (welcomeResult.status === 'fulfilled') {
      state.welcomeConfiguration = welcomeResult.value.configuration;
    } else {
      state.welcomeError = errorMessage(welcomeResult.reason);
    }
    if (ticketResult.status === 'fulfilled') {
      state.ticketConfiguration = ticketResult.value.configuration;
    } else {
      state.ticketConfigurationError = errorMessage(ticketResult.reason);
    }
    if (ticketsResult.status === 'fulfilled') {
      state.tickets = ticketsResult.value.tickets;
    } else {
      state.ticketRecordsError = errorMessage(ticketsResult.reason);
    }
    if (moderationResult.status === 'fulfilled') {
      state.moderationCases = moderationResult.value.cases;
    } else {
      state.moderationError = errorMessage(moderationResult.reason);
    }
  } catch (error) {
    if (state.selectedGuildId !== guild.id) return;
    state.guildDataError = errorMessage(error);
    if (error instanceof ApiError && error.status === 401) {
      renderSignedOut('Your Discord session expired or is no longer valid. Sign in again to continue.');
      return;
    }
    if (error instanceof ApiError && error.status === 403) {
      state.guilds = state.guilds.filter((entry) => entry.id !== guild.id);
      selectGuild('');
      showFeedback('Discord no longer confirms your access to that server. The server list has been refreshed for this page.');
      return;
    }
  }
  renderPage();
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

function setTheme(theme, announceStorageFailure = false) {
  const validTheme = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = validTheme === 'system' ? (prefersDark ? 'dark' : 'light') : validTheme;
  document.documentElement.dataset.theme = effectiveTheme;
  elements.theme.value = validTheme;
  try {
    localStorage.setItem('serverpilot-theme', validTheme);
  } catch {
    if (announceStorageFailure) {
      showFeedback('Theme changed for this session, but the browser could not save your preference.');
    }
  }
}

function showFeedback(message) {
  elements.feedback.textContent = message;
  setVisible(elements.feedback, true);
}

function clearFeedback() {
  elements.feedback.textContent = '';
  setVisible(elements.feedback, false);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...options,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('The request timed out. Check your connection and retry.');
    }
    throw new Error('ServerPilot could not be reached. Check your connection and retry.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('ServerPilot returned an unreadable response.');
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body?.error === 'string' ? body.error : undefined,
      typeof body?.message === 'string' ? body.message : undefined,
    );
  }
  return body;
}

function errorMessage(error) {
  if (error instanceof ApiError && error.code === 'database_error') {
    return 'ServerPilot could not read or save this data. The database may be unavailable or its required migration may not be applied.';
  }
  if (error instanceof ApiError && error.code === 'persistence_not_configured') {
    return 'Persistent storage is not configured for this ServerPilot deployment.';
  }
  if (error instanceof ApiError && error.code === 'discord_api_error') {
    return 'Discord could not verify the current server access. Retry after checking Discord availability.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'Discord no longer confirms access to this server. Refresh the server list and select an authorized server.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'The dashboard service is temporarily unavailable. Please retry in a moment.';
  }
  return error instanceof Error ? error.message : 'An unexpected dashboard error occurred.';
}

function setLoading(visible) {
  setVisible(elements.loading, visible);
  setVisible(elements.auth, false);
  setVisible(elements.dashboard, false);
}

function renderSignedOut(message, error) {
  setLoading(false);
  state.user = undefined;
  state.guilds = [];
  state.selectedGuildId = undefined;
  elements.profile.replaceChildren();
  setVisible(elements.profile, false);
  setVisible(elements.logout, false);
  elements.authMessage.textContent = message;
  elements.authError.textContent = error || '';
  setVisible(elements.authError, Boolean(error));
  const oauthStatus = state.health?.services?.discordOAuth;
  const storageUnavailable = oauthStatus === 'storage_unavailable';
  const configured = oauthStatus === 'configured_not_verified';
  elements.authMessage.textContent = storageUnavailable
    ? 'Discord OAuth is configured, but its session storage is unavailable. An operator must configure the backend database before sign-in can work.'
    : configured
      ? message
      : 'Discord sign-in is not configured on this deployment yet. ServerPilot will not pretend that authentication is available.';
  elements.login.textContent = configured ? 'Continue with Discord' : 'Discord sign-in unavailable';
  elements.login.setAttribute('aria-disabled', String(!configured));
  elements.login.tabIndex = configured ? 0 : -1;
  elements.login.classList.toggle('button-disabled', !configured);
  setVisible(elements.auth, true);
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function currentGuild() {
  return state.guilds.find((guild) => guild.id === state.selectedGuildId);
}

function selectGuild(guildId) {
  const allowedGuild = state.guilds.find((guild) => guild.id === guildId);
  state.selectedGuildId = allowedGuild?.id;
  state.setupPlan = undefined;
  state.setupPlanError = undefined;
  try {
    if (allowedGuild) sessionStorage.setItem('serverpilot-selected-guild', allowedGuild.id);
    else sessionStorage.removeItem('serverpilot-selected-guild');
  } catch {
    showFeedback('The server selection is active for this page, but the browser could not save it for this tab.');
  }
  renderServerSelect();
  renderPage();
  void loadSelectedGuildData();
}

function renderServerSelect() {
  elements.serverSelect.replaceChildren();
  if (state.guilds.length === 0) {
    elements.serverSelect.add(new Option('No manageable servers found', ''));
    elements.serverSelect.disabled = true;
    return;
  }
  elements.serverSelect.add(new Option('Select a server...', ''));
  for (const guild of state.guilds) {
    elements.serverSelect.add(new Option(guild.name, guild.id));
  }
  elements.serverSelect.value = state.selectedGuildId || '';
  elements.serverSelect.disabled = false;
}

function renderProfile() {
  elements.profile.replaceChildren();
  if (state.user?.avatarUrl) {
    const avatar = create('img');
    avatar.src = state.user.avatarUrl;
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    elements.profile.append(avatar);
  } else {
    const fallback = create('span', 'avatar-fallback', state.user?.username?.slice(0, 1).toUpperCase() || '?');
    fallback.setAttribute('aria-hidden', 'true');
    elements.profile.append(fallback);
  }
  elements.profile.append(create('span', '', state.user?.displayName || state.user?.username || 'Discord user'));
  setVisible(elements.profile, true);
  setVisible(elements.logout, true);
}

function renderNavigation() {
  elements.nav.replaceChildren();
  for (const page of pages) {
    const button = create('button', 'nav-link');
    button.type = 'button';
    button.dataset.page = page.id;
    button.setAttribute('aria-current', state.currentPage === page.id ? 'page' : 'false');
    button.append(create('span', 'nav-link-name', page.label));
    if (!['overview', 'servers', 'builder', 'automations', 'tickets', 'moderation', 'settings'].includes(page.id)) {
      button.append(create('span', 'nav-link-indicator', 'SOON'));
    }
    elements.nav.append(button);
  }
}

function renderGuildList(container) {
  if (state.guilds.length === 0) {
    container.append(create('div', 'empty-state', 'No servers where your current Discord account has Manage Server, Administrator, or ownership permission were returned. Check your Discord account and retry.'));
    return;
  }
  const list = create('div', 'server-list');
  for (const guild of state.guilds) {
    const button = create('button', 'server-entry');
    button.type = 'button';
    button.dataset.selectGuild = guild.id;
    button.setAttribute('aria-pressed', String(guild.id === state.selectedGuildId));
    if (guild.iconUrl) {
      const icon = create('img');
      icon.src = guild.iconUrl;
      icon.alt = '';
      icon.referrerPolicy = 'no-referrer';
      button.append(icon);
    } else {
      const fallback = create('span', 'avatar-fallback', guild.name.slice(0, 1).toUpperCase());
      fallback.setAttribute('aria-hidden', 'true');
      button.append(fallback);
    }
    const copy = create('span', 'server-entry-copy');
    copy.append(create('strong', '', guild.name));
    copy.append(create('small', '', 'Discord management permission verified'));
    button.append(copy, create('span', 'badge badge-warning', 'Bot status not verified'));
    list.append(button);
  }
  container.append(list);
}

function statusCard(title, value, description, status, statusClass = 'badge-info') {
  const card = create('article', 'card status-card');
  card.append(create('span', 'status-dot status-dot-info'));
  const copy = create('div');
  copy.append(create('h2', '', title));
  copy.append(create('div', 'card-value', value));
  copy.append(create('p', '', description));
  card.append(copy, create('span', `badge ${statusClass}`, status));
  return card;
}

function renderOverview(container) {
  const guild = currentGuild();
  if (!guild) {
    const empty = create('div', 'empty-state', 'Select an authorized Discord server to see its dashboard status. ServerPilot does not generate sample metrics or health scores.');
    container.append(empty);
    return;
  }

  const summary = create('section', 'card');
  summary.append(create('span', 'badge badge-success', 'Discord access verified'));
  const overviewGuild = state.overview?.guild;
  summary.append(create('h2', '', overviewGuild?.name || guild.name));
  summary.append(create('p', '', 'This server was returned by Discord after a live permission check. Future guild-scoped API requests will verify your access again on the server.'));
  container.append(summary);

  const grid = create('div', 'content-grid');
  const memberCount = overviewGuild?.memberCount;
  const automationSummary = state.overview?.automations;
  const ticketSummary = state.overview?.tickets;
  grid.append(
    statusCard('Members', memberCount?.kind === 'discord_approximate' && Number.isInteger(memberCount.value)
      ? `About ${memberCount.value.toLocaleString()}`
      : 'Not available yet',
    memberCount?.kind === 'discord_approximate'
      ? 'Approximate member count reported by Discord; this is not a historical trend.'
      : 'Discord did not provide an approximate member count for this server.',
    memberCount?.kind === 'discord_approximate' ? 'Discord estimate' : 'Unavailable'),
    statusCard('Automations', Number.isInteger(automationSummary?.total)
      ? `${automationSummary.enabled} enabled / ${automationSummary.total} total`
      : 'Not available yet',
    Number.isInteger(automationSummary?.total)
      ? 'Definitions are read from the same repository used by the ServerPilot automation engine.'
      : 'Persistent automation storage is not configured or available.',
    Number.isInteger(automationSummary?.total) ? 'Connected' : 'Unavailable',
    Number.isInteger(automationSummary?.total) ? 'badge-success' : 'badge-warning'),
    statusCard('Open tickets', Number.isInteger(ticketSummary?.open)
      ? String(ticketSummary.open)
      : 'Not available yet',
    Number.isInteger(ticketSummary?.open)
      ? 'Open ticket records from the existing ticket service.'
      : 'Ticket lifecycle persistence is not configured or available.',
    Number.isInteger(ticketSummary?.open) ? 'Connected' : 'Unavailable',
    Number.isInteger(ticketSummary?.open) ? 'badge-success' : 'badge-warning'),
    statusCard('ServerPilot bot connection', 'Not verified', 'The dashboard does not yet verify whether ServerPilot is installed or online in this server.', 'Not verified', 'badge-warning'),
    statusCard('Community health', 'Insufficient data', 'No persisted history is connected, so ServerPilot will not calculate or invent a health score.', 'Insufficient data', 'badge-warning'),
  );
  if (state.guildDataError) {
    const error = create('div', 'empty-state', state.guildDataError);
    container.append(error);
  }
  container.append(grid);
}

function renderServers(container) {
  const card = create('section', 'card');
  card.append(create('h2', '', 'Servers you can manage'));
  card.append(create('p', '', 'Discord permissions are checked by the backend. Selecting a server changes the dashboard context only; it does not grant authority to future API requests.'));
  renderGuildList(card);
  container.append(card);
}

function renderComingSoon(container, page) {
  const card = create('section', 'card');
  card.append(create('span', 'badge badge-warning', 'Coming soon'));
  card.append(create('h2', '', 'This dashboard service is not connected'));
  card.append(create('p', '', page.description));
  const explanation = create('p', 'muted');
  explanation.classList.add('coming-soon-note');
  explanation.textContent = 'No sample records, controls, or successful actions are shown here. This screen will be enabled only when it uses a validated backend service and guild-scoped persistence.';
  card.append(explanation);
  container.append(card);
}

function renderAutomations(container) {
  if (!currentGuild()) {
    container.append(create('div', 'empty-state', 'Select an authorized server to view its automations.'));
    return;
  }
  if (state.guildDataError) {
    const error = create('section', 'card');
    error.append(create('span', 'badge badge-warning', 'Unavailable'));
    error.append(create('h2', '', 'Could not load automations'));
    error.append(create('p', '', state.guildDataError));
    const retry = create('button', 'button button-quiet', 'Retry');
    retry.type = 'button';
    retry.dataset.retryGuildData = 'true';
    error.append(retry);
    container.append(error);
    return;
  }
  if (!Array.isArray(state.automations)) {
    container.append(create('div', 'empty-state', 'Loading automations from ServerPilot...'));
    return;
  }
  if (state.automations.length === 0) {
    container.append(create('div', 'empty-state', 'No automations are configured for this server.'));
    return;
  }
  for (const automation of state.automations) {
    const card = create('article', 'card automation-card');
    const top = create('div', 'automation-card-heading');
    const heading = create('div');
    heading.append(create('h2', '', automation.name));
    heading.append(create('p', '', `WHEN ${String(automation.trigger?.type || 'unknown').replaceAll('_', ' ')} · ${automation.conditions?.length || 0} condition(s) · ${automation.actions?.length || 0} action(s)`));
    top.append(heading, create('span', `badge ${automation.enabled ? 'badge-success' : 'badge-warning'}`, automation.enabled ? 'Enabled' : 'Disabled'));
    card.append(top);
    const details = create('details', 'automation-details');
    details.append(create('summary', '', 'Inspect conditions and actions'));
    details.append(create('p', '', `Trigger: ${automation.trigger?.type || 'unknown'}`));
    const conditions = create('ul');
    for (const condition of automation.conditions || []) {
      conditions.append(create('li', '', conditionSummary(condition)));
    }
    if (!automation.conditions?.length) conditions.append(create('li', '', 'No conditions'));
    details.append(create('strong', '', 'Conditions'));
    details.append(conditions);
    const actionsList = create('ol');
    for (const action of automation.actions || []) {
      actionsList.append(create('li', '', actionSummary(action)));
    }
    details.append(create('strong', '', 'Actions'));
    details.append(actionsList);
    card.append(details);
    const actions = create('div', 'automation-actions');
    const statusButton = create('button', 'button button-quiet', automation.enabled ? 'Disable' : 'Enable');
    statusButton.type = 'button';
    statusButton.dataset.automationToggle = automation.id;
    statusButton.dataset.enabled = String(automation.enabled);
    actions.append(statusButton);
    const deleteButton = create('button', 'button button-danger', 'Delete');
    deleteButton.type = 'button';
    deleteButton.dataset.automationDelete = automation.id;
    actions.append(deleteButton);
    card.append(actions);
    container.append(card);
  }
}

function conditionSummary(condition) {
  if (condition.type === 'HAS_ROLE') return `Member has role ${condition.roleId}`;
  if (condition.type === 'DOES_NOT_HAVE_ROLE') return `Member does not have role ${condition.roleId}`;
  if (condition.type === 'CHANNEL_IS') return `Channel is ${condition.channelId}`;
  if (condition.type === 'WARNING_COUNT') return `Warning count ${String(condition.operator).replaceAll('_', ' ').toLowerCase()} ${condition.value}`;
  return 'Unsupported stored condition';
}

function actionSummary(action) {
  if (action.type === 'ADD_ROLE' || action.type === 'REMOVE_ROLE') return `${action.type === 'ADD_ROLE' ? 'Add' : 'Remove'} role ${action.roleId}`;
  if (action.type === 'SEND_MESSAGE') return `Send message to ${action.channelId}: ${action.message}`;
  if (action.type === 'SEND_DM') return `Send direct message: ${action.message}`;
  if (action.type === 'ADD_WARNING') return `Add warning: ${action.reason}`;
  if (action.type === 'TIMEOUT_MEMBER') return `Timeout for ${action.durationMinutes} minute(s): ${action.reason}`;
  if (action.type === 'NOTIFY_ROLE') return `Notify role ${action.roleId} in ${action.channelId}: ${action.message}`;
  return 'Unsupported stored action';
}

function renderSettings(container) {
  if (!currentGuild()) {
    container.append(create('div', 'empty-state', 'Select an authorized server to inspect its configuration.'));
    return;
  }
  const card = create('section', 'card');
  card.append(create('h2', '', 'Welcome messages'));
  if (state.welcomeError) {
    card.append(create('span', 'badge badge-warning', 'Unavailable'));
    card.append(create('p', '', state.welcomeError));
  } else if (state.welcomeConfiguration === undefined) {
    card.append(create('p', '', 'Loading the configuration used by the existing Discord welcome service...'));
  } else if (!state.welcomeConfiguration) {
    card.append(create('span', 'badge badge-info', 'Not configured'));
    card.append(create('p', '', 'No welcome configuration is stored for this server.'));
  } else {
    const configuration = state.welcomeConfiguration;
    card.append(create('span', `badge ${configuration.enabled ? 'badge-success' : 'badge-warning'}`, configuration.enabled ? 'Enabled' : 'Disabled'));
    card.append(create('p', 'card-value', `Channel: ${configuration.channelId ? `<#${configuration.channelId}>` : 'Not selected'}`));
    card.append(create('p', '', `Message: ${configuration.message}`));
    card.append(create('p', 'coming-soon-note', 'Configuration is read from the same repository used by the bot. Changes remain in the existing Discord command flow until dashboard-side Discord permission validation is implemented.'));
  }
  container.append(card);
}

function renderTickets(container) {
  if (!currentGuild()) {
    container.append(create('div', 'empty-state', 'Select an authorized server to inspect ticket configuration.'));
    return;
  }
  const configurationCard = create('section', 'card');
  configurationCard.append(create('h2', '', 'Ticket configuration'));
  if (state.ticketConfigurationError) {
    configurationCard.append(create('span', 'badge badge-warning', 'Unavailable'));
    configurationCard.append(create('p', '', state.ticketConfigurationError));
  } else if (state.ticketConfiguration === undefined) {
    configurationCard.append(create('p', '', 'Loading configuration from the existing ticket workflow...'));
  } else if (!state.ticketConfiguration) {
    configurationCard.append(create('span', 'badge badge-info', 'Not configured'));
    configurationCard.append(create('p', '', 'No ticket configuration is stored for this server.'));
  } else {
    const configuration = state.ticketConfiguration;
    configurationCard.append(create('span', `badge ${configuration.enabled ? 'badge-success' : 'badge-warning'}`, configuration.enabled ? 'Enabled' : 'Disabled'));
    configurationCard.append(create('p', 'coming-soon-note', `Support category: ${configuration.categoryId}`));
    configurationCard.append(create('p', '', `Support role: ${configuration.supportRoleId}`));
    configurationCard.append(create('p', '', `Log channel: ${configuration.logChannelId}`));
    configurationCard.append(create('p', '', `Panel channel: ${configuration.panelChannelId}`));
  }
  container.append(configurationCard);
  const history = create('section', 'card');
  history.append(create('h2', '', 'Ticket history'));
  if (state.ticketRecordsError) {
    history.append(create('span', 'badge badge-warning', 'Unavailable'));
    history.append(create('p', '', state.ticketRecordsError));
  } else if (!Array.isArray(state.tickets)) {
    history.append(create('p', '', 'Loading ticket records...'));
  } else if (state.tickets.length === 0) {
    history.append(create('span', 'badge badge-info', 'No records'));
    history.append(create('p', '', 'No ticket lifecycle records are stored for this server.'));
  } else {
    for (const ticket of state.tickets) {
      const entry = create('div', 'ticket-row');
      const summary = create('div');
      summary.append(create('strong', '', `Ticket ${ticket.channelId}`));
      summary.append(create('p', '', `Creator: ${ticket.creatorId} · Opened ${new Date(ticket.openedAt).toLocaleString()}`));
      entry.append(summary, create('span', `badge ${ticket.status === 'open' ? 'badge-success' : 'badge-info'}`, ticket.status));
      history.append(entry);
    }
  }
  container.append(history);
}

function renderModeration(container) {
  if (!currentGuild()) {
    container.append(create('div', 'empty-state', 'Select an authorized server to view moderation history.'));
    return;
  }
  if (state.moderationError) {
    container.append(create('div', 'empty-state', state.moderationError));
    return;
  }
  if (!Array.isArray(state.moderationCases)) {
    container.append(create('div', 'empty-state', 'Loading stored moderation cases...'));
    return;
  }
  if (state.moderationCases.length === 0) {
    container.append(create('div', 'empty-state', 'No persisted moderation cases are available for this server.'));
    return;
  }
  for (const entry of state.moderationCases) {
    const card = create('article', 'card moderation-case');
    const heading = create('div', 'automation-card-heading');
    heading.append(create('h2', '', entry.action.toUpperCase()));
    heading.append(create('span', 'badge badge-info', new Date(entry.createdAt).toLocaleString()));
    card.append(heading);
    card.append(create('p', '', `Target: ${entry.targetUserId} · Moderator: ${entry.moderatorUserId || 'Unknown'}`));
    card.append(create('p', 'coming-soon-note', `Reason: ${entry.reason}`));
    if (Number.isInteger(entry.durationSeconds)) {
      card.append(create('p', '', `Duration: ${Math.round(entry.durationSeconds / 60)} minutes`));
    }
    container.append(card);
  }
}

function renderSetupBuilder(container) {
  if (!currentGuild()) {
    container.append(create('div', 'empty-state', 'Select an authorized server before requesting a server plan.'));
    return;
  }
  const form = create('form', 'card setup-form');
  form.dataset.setupPlan = 'true';
  form.append(create('h2', '', 'Describe your community'));
  const typeLabel = create('label', 'form-label', 'Community type');
  const typeSelect = create('select', 'form-control');
  typeSelect.name = 'type';
  for (const [value, label] of [['Community', 'Community'], ['Gaming', 'Gaming'], ['Esports', 'Esports'], ['Creator', 'Creator'], ['Business', 'Business'], ['Custom', 'Custom']]) {
    typeSelect.add(new Option(label, value));
  }
  typeLabel.append(typeSelect);
  form.append(typeLabel);
  const descriptionLabel = create('label', 'form-label', 'What should ServerPilot plan?');
  const description = create('textarea', 'form-control');
  description.name = 'description';
  description.required = true;
  description.minLength = 10;
  description.maxLength = 1000;
  description.rows = 5;
  description.placeholder = 'Describe your community, what you need, and anything you do not want.';
  descriptionLabel.append(description);
  form.append(descriptionLabel);
  const submit = create('button', 'button button-primary', 'Generate preview');
  submit.type = 'submit';
  form.append(submit);
  container.append(form);

  if (state.setupPlanError) container.append(create('div', 'empty-state', state.setupPlanError));
  if (state.setupPlan) {
    const plan = state.setupPlan;
    const preview = create('section', 'card setup-preview');
    preview.append(create('span', 'badge badge-info', 'Plan preview · no Discord changes made'));
    preview.append(create('h2', '', `${plan.type} community plan`));
    preview.append(create('p', '', plan.description));
    for (const category of [...plan.categories, ...plan.voiceCategories]) {
      const block = create('div', 'plan-category');
      block.append(create('h3', '', category.name));
      block.append(create('p', '', category.channels.map((channel) =>
        plan.voiceCategories.includes(category) ? `🔊 ${channel}` : `# ${channel}`,
      ).join(' · ')));
      preview.append(block);
    }
    if (plan.roles?.length) {
      preview.append(create('h3', 'coming-soon-note', 'Roles'));
      preview.append(create('p', '', plan.roles.map((role) => role.name).join(' · ')));
    }
    if (plan.rules?.length) {
      preview.append(create('h3', 'coming-soon-note', 'Rules'));
      preview.append(create('p', '', plan.rules.join(' · ')));
    }
    preview.append(create('p', 'builder-safety-note', 'Applying this plan from the dashboard is not implemented. Nothing has been created or changed in Discord.'));
    container.append(preview);
  }
}

function renderPage() {
  const page = pages.find((entry) => entry.id === state.currentPage) || pages[0];
  elements.heading.replaceChildren();
  elements.heading.append(create('h1', '', page.label));
  elements.heading.append(create('p', '', page.description));
  elements.content.replaceChildren();
  if (page.id === 'overview') renderOverview(elements.content);
  else if (page.id === 'servers') renderServers(elements.content);
  else if (page.id === 'automations') renderAutomations(elements.content);
  else if (page.id === 'tickets') renderTickets(elements.content);
  else if (page.id === 'moderation') renderModeration(elements.content);
  else if (page.id === 'builder') renderSetupBuilder(elements.content);
  else if (page.id === 'settings') renderSettings(elements.content);
  else renderComingSoon(elements.content, page);
  renderNavigation();
}

function showDashboard() {
  setLoading(false);
  setVisible(elements.dashboard, true);
  renderProfile();
  renderServerSelect();
  renderPage();
}

async function loadDashboard() {
  setLoading(true);
  clearFeedback();
  try {
    state.health = await api('/api/v1/health');
    let me;
    try {
      me = await api('/api/v1/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        renderSignedOut('Sign in with Discord to continue.');
        return;
      }
      throw error;
    }
    state.user = me.user;
    const guildResponse = await api('/api/v1/guilds');
    if (!Array.isArray(guildResponse.guilds)) {
      throw new Error('ServerPilot returned an invalid server list.');
    }
    state.guilds = guildResponse.guilds.filter((guild) =>
      guild && typeof guild.id === 'string' && typeof guild.name === 'string',
    );
    let rememberedGuild;
    try {
      rememberedGuild = sessionStorage.getItem('serverpilot-selected-guild');
    } catch {
      showFeedback('Browser session storage is unavailable. Select a server again after reloading this tab.');
    }
    state.selectedGuildId = state.guilds.some((guild) => guild.id === rememberedGuild)
      ? rememberedGuild
      : undefined;
    renderDashboard();
    if (state.selectedGuildId) void loadSelectedGuildData();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      renderSignedOut('Your Discord session expired or is no longer valid. Sign in again to continue.');
      return;
    }
    setLoading(false);
    setVisible(elements.auth, true);
    elements.authMessage.textContent = 'The dashboard could not load your account or authorized servers.';
    elements.authError.textContent = errorMessage(error);
    setVisible(elements.authError, true);
  }
}

function renderDashboard() {
  showDashboard();
}

function csrfToken() {
  for (const part of document.cookie.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === 'sp_csrf') return decodeURIComponent(valueParts.join('='));
  }
  return '';
}

elements.authRetry.addEventListener('click', () => {
  void loadDashboard();
});

elements.serverSelect.addEventListener('change', () => {
  selectGuild(elements.serverSelect.value);
});

elements.nav.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-page]') : null;
  if (!(target instanceof HTMLButtonElement)) return;
  state.currentPage = target.dataset.page || 'overview';
  renderPage();
});

elements.content.addEventListener('click', (event) => {
  const retryTarget = event.target instanceof Element ? event.target.closest('[data-retry-guild-data]') : null;
  if (retryTarget) {
    void loadSelectedGuildData();
    return;
  }
  const target = event.target instanceof Element ? event.target.closest('[data-select-guild]') : null;
  if (target instanceof HTMLButtonElement) {
    selectGuild(target.dataset.selectGuild || '');
    return;
  }

  const toggleTarget = event.target instanceof Element ? event.target.closest('[data-automation-toggle]') : null;
  if (toggleTarget instanceof HTMLButtonElement) {
    const enable = toggleTarget.dataset.enabled !== 'true';
    const automation = state.automations?.find((entry) => entry.id === toggleTarget.dataset.automationToggle);
    if (enable && !window.confirm(`Enable "${automation?.name || 'this automation'}"? It may perform its configured actions when the trigger occurs.`)) return;
    void updateAutomation(toggleTarget.dataset.automationToggle, { enabled: enable });
    return;
  }
  const deleteTarget = event.target instanceof Element ? event.target.closest('[data-automation-delete]') : null;
  if (deleteTarget instanceof HTMLButtonElement) {
    const automation = state.automations?.find((entry) => entry.id === deleteTarget.dataset.automationDelete);
    if (!window.confirm(`Permanently delete "${automation?.name || 'this automation'}"? This cannot be undone.`)) return;
    void deleteAutomation(deleteTarget.dataset.automationDelete);
  }
});

elements.content.addEventListener('submit', async (event) => {
  const form = event.target instanceof HTMLFormElement && event.target.matches('[data-setup-plan]')
    ? event.target
    : undefined;
  if (!form) return;
  event.preventDefault();
  const guild = currentGuild();
  if (!guild) return;
  const formData = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  state.setupPlanError = undefined;
  try {
    const response = await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/setup/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({
        type: formData.get('type'),
        description: formData.get('description'),
      }),
    });
    state.setupPlan = response.plan;
    renderPage();
  } catch (error) {
    state.setupPlanError = errorMessage(error);
    renderPage();
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});

async function updateAutomation(id, patch) {
  const guild = currentGuild();
  if (!guild || !id) return;
  try {
    await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify(patch),
    });
    showFeedback(patch.enabled ? 'Automation enabled.' : 'Automation disabled.');
    await loadSelectedGuildData();
  } catch (error) {
    showFeedback(errorMessage(error));
  }
}

async function deleteAutomation(id) {
  const guild = currentGuild();
  if (!guild || !id) return;
  try {
    await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/automations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ confirm: true }),
    });
    showFeedback('Automation deleted.');
    await loadSelectedGuildData();
  } catch (error) {
    showFeedback(errorMessage(error));
  }
}

elements.logout.addEventListener('click', async () => {
  elements.logout.disabled = true;
  try {
    await api('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken() },
    });
    try {
      sessionStorage.removeItem('serverpilot-selected-guild');
    } catch {
      // The logout request succeeded; clearing an optional browser preference is best-effort.
    }
    await loadDashboard();
  } catch (error) {
    showFeedback(errorMessage(error));
  } finally {
    elements.logout.disabled = false;
  }
});

elements.theme.addEventListener('change', () => setTheme(elements.theme.value, true));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (elements.theme.value === 'system') setTheme('system');
});

let savedTheme = 'dark';
try {
  const storedTheme = localStorage.getItem('serverpilot-theme');
  if (['dark', 'light', 'system'].includes(storedTheme)) savedTheme = storedTheme;
} catch {
  showFeedback('Browser storage is unavailable. The dashboard is using the default dark theme for this visit.');
}
setTheme(savedTheme);
void loadDashboard();
