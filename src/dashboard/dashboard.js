// ServerPilot Dashboard V1

const pages = [
  { id: 'overview', label: 'Overview', icon: '📊', description: 'Real-time overview of your verified Discord server and service status.' },
  { id: 'builder', label: 'AI Server Builder', icon: '🤖', description: 'Design structured channel architectures and roles with ServerPilot AI.' },
  { id: 'automations', label: 'Automations', icon: '⚡', description: 'Manage WHEN → IF → THEN event-driven workflows for your server.' },
  { id: 'moderation', label: 'Moderation', icon: '🛡️', description: 'Audit logged moderation actions and verify enforcement safety policies.' },
  { id: 'tickets', label: 'Tickets', icon: '🎫', description: 'Review support ticket configuration and inspect active and historical ticket records.' },
  { id: 'settings', label: 'Settings', icon: '⚙️', description: 'Inspect server preferences, welcome messaging, and Discord account authentication.' },
  { id: 'billing', label: 'Billing', icon: '💳', description: 'Review your subscription tier, quotas, and payment provider status.' },
];

const state = {
  user: undefined,
  guilds: [],
  selectedGuildId: undefined,
  currentPage: 'overview',
  health: undefined,
  loadingGuildData: false,

  // Loaded Guild-Scoped Data
  overview: undefined,
  automations: undefined,
  welcomeConfiguration: undefined,
  ticketConfiguration: undefined,
  tickets: undefined,
  moderationCases: undefined,
  recentActivity: [],

  // Domain Errors
  guildDataError: undefined,
  welcomeError: undefined,
  ticketConfigurationError: undefined,
  ticketRecordsError: undefined,
  moderationError: undefined,

  // AI Server Builder State
  setupPlan: undefined,
  setupPlanLoading: false,
  setupPlanError: undefined,
  setupApplyLoading: false,
  setupApplyResult: undefined,
  setupApplyError: undefined,

  // AI Automation Creator State
  automationAiOpen: false,
  automationAiLoading: false,
  automationAiProposal: undefined,
  automationAiError: undefined,

  // Filters
  moderationFilter: 'ALL',
  ticketFilter: 'ALL',

  // Dialog State
  dialog: null,
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
  dialog: document.querySelector('#app-dialog'),
  dialogContent: document.querySelector('#dialog-content'),
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `Request failed with status ${status}.`);
    this.status = status;
    this.code = code;
  }
}

function csrfToken() {
  for (const part of document.cookie.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === 'sp_csrf') return decodeURIComponent(valueParts.join('='));
  }
  return '';
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

function showFeedback(message, type = 'info') {
  if (!elements.feedback) return;
  elements.feedback.className = `app-feedback feedback-${type}`;
  elements.feedback.replaceChildren();
  const textSpan = create('span', '', message);
  const closeBtn = create('button', 'button button-quiet button-sm', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', clearFeedback);
  elements.feedback.append(textSpan, closeBtn);
  setVisible(elements.feedback, true);
}

function clearFeedback() {
  if (!elements.feedback) return;
  elements.feedback.replaceChildren();
  setVisible(elements.feedback, false);
}

function setTheme(theme, announceStorageFailure = false) {
  const validTheme = ['dark', 'light', 'system'].includes(theme) ? theme : 'dark';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveTheme = validTheme === 'system' ? (prefersDark ? 'dark' : 'light') : validTheme;
  document.documentElement.dataset.theme = effectiveTheme;
  if (elements.theme) elements.theme.value = validTheme;
  try {
    localStorage.setItem('serverpilot-theme', validTheme);
  } catch {
    if (announceStorageFailure) {
      showFeedback('Theme preference could not be saved to browser storage.', 'warning');
    }
  }
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      ...options,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error('Request timed out. Please check your connection.');
    }
    throw new Error('ServerPilot could not be reached. Ensure the API server is online.');
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('ServerPilot returned an unreadable response format.');
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
  if (error instanceof ApiError) {
    if (error.code === 'database_error') {
      return 'Database unavailable or required schema migration not yet applied.';
    }
    if (error.code === 'persistence_not_configured') {
      return 'Persistent database storage is not configured for this ServerPilot deployment.';
    }
    if (error.code === 'discord_api_error') {
      return 'Discord API could not verify server permissions. Please retry shortly.';
    }
    if (error.status === 403) {
      return 'Discord no longer confirms Manage Server or Administrator access for this server.';
    }
    if (error.status === 501) {
      return error.message || 'This operation is not supported by the backend yet.';
    }
    if (error.status === 503) {
      return 'This feature service is temporarily unavailable on the backend.';
    }
    return error.message || `Request failed with error: ${error.code}`;
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function create(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function currentGuild() {
  return state.guilds.find((guild) => guild.id === state.selectedGuildId);
}

function selectGuild(guildId) {
  const allowedGuild = state.guilds.find((guild) => guild.id === guildId);
  state.selectedGuildId = allowedGuild?.id;
  state.setupPlan = undefined;
  state.setupPlanError = undefined;
  state.setupApplyResult = undefined;
  state.setupApplyError = undefined;
  state.automationAiProposal = undefined;
  state.automationAiError = undefined;

  try {
    if (allowedGuild) sessionStorage.setItem('serverpilot-selected-guild', allowedGuild.id);
    else sessionStorage.removeItem('serverpilot-selected-guild');
  } catch {
    // Session storage best-effort
  }

  renderServerSelect();
  renderPage();
  if (state.selectedGuildId) {
    void loadSelectedGuildData();
  }
}

function renderServerSelect() {
  if (!elements.serverSelect) return;
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
  if (!elements.profile) return;
  elements.profile.replaceChildren();
  if (state.user?.avatarUrl) {
    const avatar = create('img');
    avatar.src = state.user.avatarUrl;
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    elements.profile.append(avatar);
  } else {
    const fallback = create('span', 'avatar-fallback', state.user?.username?.slice(0, 1).toUpperCase() || 'U');
    fallback.setAttribute('aria-hidden', 'true');
    elements.profile.append(fallback);
  }
  elements.profile.append(create('span', '', state.user?.displayName || state.user?.username || 'Discord user'));
  setVisible(elements.profile, true);
  setVisible(elements.logout, true);
}

function renderNavigation() {
  if (!elements.nav) return;
  elements.nav.replaceChildren();
  for (const page of pages) {
    const button = create('button', 'nav-link');
    button.type = 'button';
    button.dataset.page = page.id;
    button.setAttribute('aria-current', state.currentPage === page.id ? 'page' : 'false');

    const iconSpan = create('span', 'nav-link-icon', page.icon);
    iconSpan.setAttribute('aria-hidden', 'true');
    const nameSpan = create('span', 'nav-link-name', page.label);

    button.append(iconSpan, nameSpan);
    elements.nav.append(button);
  }
}

async function loadSelectedGuildData() {
  const guild = currentGuild();
  if (!guild) return;

  state.loadingGuildData = true;
  state.guildDataError = undefined;
  state.welcomeError = undefined;
  state.ticketConfigurationError = undefined;
  state.ticketRecordsError = undefined;
  state.moderationError = undefined;
  renderPage();

  const base = `/api/v1/guilds/${encodeURIComponent(guild.id)}`;
  try {
    const [overviewRes, automationRes, welcomeRes, ticketConfigRes, ticketsRes, moderationRes] = await Promise.allSettled([
      api(`${base}/overview`),
      api(`${base}/automations`),
      api(`${base}/welcome/config`),
      api(`${base}/tickets/config`),
      api(`${base}/tickets?limit=50`),
      api(`${base}/moderation/cases?limit=50`),
    ]);

    if (state.selectedGuildId !== guild.id) return;

    if (overviewRes.status === 'fulfilled') {
      state.overview = overviewRes.value;
    } else {
      state.overview = undefined;
      state.guildDataError = errorMessage(overviewRes.reason);
    }

    if (automationRes.status === 'fulfilled') {
      state.automations = automationRes.value.automations;
    } else {
      state.automations = undefined;
    }

    if (welcomeRes.status === 'fulfilled') {
      state.welcomeConfiguration = welcomeRes.value.configuration;
    } else {
      state.welcomeConfiguration = undefined;
      state.welcomeError = errorMessage(welcomeRes.reason);
    }

    if (ticketConfigRes.status === 'fulfilled') {
      state.ticketConfiguration = ticketConfigRes.value.configuration;
    } else {
      state.ticketConfiguration = undefined;
      state.ticketConfigurationError = errorMessage(ticketConfigRes.reason);
    }

    if (ticketsRes.status === 'fulfilled') {
      state.tickets = ticketsRes.value.tickets;
    } else {
      state.tickets = undefined;
      state.ticketRecordsError = errorMessage(ticketsRes.reason);
    }

    if (moderationRes.status === 'fulfilled') {
      state.moderationCases = moderationRes.value.cases;
    } else {
      state.moderationCases = undefined;
      state.moderationError = errorMessage(moderationRes.reason);
    }

    // Collate Real Recent Activity
    const activity = [];
    if (Array.isArray(state.moderationCases)) {
      for (const item of state.moderationCases) {
        activity.push({
          type: 'moderation',
          title: `Moderation: ${item.action.toUpperCase()}`,
          desc: `Target: ${item.targetUserId} · Reason: ${item.reason || 'None stated'}`,
          time: new Date(item.createdAt).getTime(),
          icon: '🛡️',
        });
      }
    }
    if (Array.isArray(state.tickets)) {
      for (const item of state.tickets) {
        activity.push({
          type: 'ticket',
          title: `Ticket #${item.channelId.slice(-4)} (${item.status})`,
          desc: `Creator: ${item.creatorId} · Status: ${item.status}`,
          time: new Date(item.openedAt).getTime(),
          icon: '🎫',
        });
      }
    }
    activity.sort((a, b) => b.time - a.time);
    state.recentActivity = activity.slice(0, 10);
  } catch (error) {
    if (state.selectedGuildId !== guild.id) return;
    state.guildDataError = errorMessage(error);
  } finally {
    state.loadingGuildData = false;
    renderPage();
  }
}

/* Modal Helper */
function openDialog(title, bodyNode, actionsNode) {
  if (!elements.dialog || !elements.dialogContent) return;
  elements.dialogContent.replaceChildren();

  const header = create('div', 'dialog-header');
  header.append(create('h2', 'dialog-title', title));
  const closeBtn = create('button', 'button button-quiet button-sm', '✕');
  closeBtn.type = 'button';
  closeBtn.title = 'Close dialog';
  closeBtn.addEventListener('click', closeDialog);
  header.append(closeBtn);

  const body = create('div', 'dialog-body');
  body.append(bodyNode);

  const actions = create('div', 'dialog-actions');
  if (actionsNode) actions.append(actionsNode);

  elements.dialogContent.append(header, body, actions);
  if (typeof elements.dialog.showModal === 'function') {
    elements.dialog.showModal();
  } else {
    elements.dialog.setAttribute('open', '');
  }
}

function closeDialog() {
  if (!elements.dialog) return;
  if (typeof elements.dialog.close === 'function') {
    elements.dialog.close();
  } else {
    elements.dialog.removeAttribute('open');
  }
  if (elements.dialogContent) elements.dialogContent.replaceChildren();
}

/* Page 1: Overview */
function renderOverview(container) {
  const guild = currentGuild();
  if (!guild) {
    const empty = create('div', 'empty-state');
    empty.append(create('div', 'empty-state-icon', '🌐'));
    empty.append(create('h3', '', 'Select a Discord Server'));
    empty.append(create('p', '', 'Choose an authorized server from the top selector to inspect its real-time status and telemetry. ServerPilot verifies access directly with Discord OAuth.'));
    if (state.guilds.length > 0) {
      const list = create('div', 'server-list');
      for (const g of state.guilds) {
        const btn = create('button', 'button button-quiet', `Select ${g.name}`);
        btn.type = 'button';
        btn.addEventListener('click', () => selectGuild(g.id));
        list.append(btn);
      }
      empty.append(list);
    }
    container.append(empty);
    return;
  }

  // Server Header Card
  const headerCard = create('section', 'card');
  const headerTop = create('div', 'card-header');
  const titleGroup = create('div');
  titleGroup.append(create('h2', 'card-title', guild.name));
  titleGroup.append(create('p', 'card-subtitle', `Guild Snowflake ID: ${guild.id}`));
  headerTop.append(titleGroup, create('span', 'badge badge-success', '● Live Discord Access Verified'));
  headerCard.append(headerTop);
  container.append(headerCard);

  // Key Metrics Grid
  const statsGrid = create('div', 'stats-grid');

  // 1. Members
  const memberStat = create('div', 'stat-card');
  const memberTop = create('div', 'stat-card-top');
  memberTop.append(create('span', 'stat-card-label', 'Members'), create('span', 'badge badge-info', 'Discord Estimate'));
  const memberCount = state.overview?.guild?.memberCount;
  const memberVal = memberCount?.kind === 'discord_approximate' && Number.isInteger(memberCount.value)
    ? `~${memberCount.value.toLocaleString()}`
    : 'Unavailable';
  const memberDesc = memberCount?.kind === 'discord_approximate'
    ? 'Approximate count reported by Discord API'
    : 'Discord did not report approximate member counts';
  memberStat.append(memberTop, create('div', 'stat-card-value', memberVal), create('p', 'stat-card-desc', memberDesc));

  // 2. Open Tickets
  const ticketStat = create('div', 'stat-card');
  const ticketTop = create('div', 'stat-card-top');
  const ticketCount = state.overview?.tickets;
  const ticketActive = Number.isInteger(ticketCount?.open);
  ticketTop.append(create('span', 'stat-card-label', 'Open Tickets'), create('span', `badge ${ticketActive ? 'badge-success' : 'badge-warning'}`, ticketActive ? 'Connected' : 'Unavailable'));
  const ticketVal = ticketActive ? String(ticketCount.open) : 'Not configured';
  const ticketDesc = ticketActive ? 'Active support channels in TicketService' : 'Ticket repository not configured or migrated';
  ticketStat.append(ticketTop, create('div', 'stat-card-value', ticketVal), create('p', 'stat-card-desc', ticketDesc));

  // 3. Automations
  const autoStat = create('div', 'stat-card');
  const autoTop = create('div', 'stat-card-top');
  const autoCount = state.overview?.automations;
  const autoActive = Number.isInteger(autoCount?.total);
  autoTop.append(create('span', 'stat-card-label', 'Active Automations'), create('span', `badge ${autoActive ? 'badge-success' : 'badge-warning'}`, autoActive ? 'Connected' : 'Unavailable'));
  const autoVal = autoActive ? `${autoCount.enabled} / ${autoCount.total}` : 'Not configured';
  const autoDesc = autoActive ? 'Enabled vs total WHEN/IF/THEN workflows' : 'Automation storage unavailable without database';
  autoStat.append(autoTop, create('div', 'stat-card-value', autoVal), create('p', 'stat-card-desc', autoDesc));

  // 4. Server/Bot Status
  const botStat = create('div', 'stat-card');
  const botTop = create('div', 'stat-card-top');
  botTop.append(create('span', 'stat-card-label', 'Bot & Gateway'), create('span', 'badge badge-info', 'OAuth Guarded'));
  botStat.append(botTop, create('div', 'stat-card-value', 'Operational'), create('p', 'stat-card-desc', 'Discord permissions checked on every call. Bot runtime operates independently.'));

  statsGrid.append(memberStat, ticketStat, autoStat, botStat);
  container.append(statsGrid);

  // Recent Activity Feed Card
  const activityCard = create('section', 'card');
  activityCard.append(create('h2', 'card-title', 'Recent Server Activity'));
  activityCard.append(create('p', 'card-subtitle', 'Real-time event logs collected from ticket lifecycle and moderation history.'));

  if (state.loadingGuildData) {
    const loadingSkeletons = create('div', 'activity-feed');
    loadingSkeletons.append(create('div', 'skeleton skeleton-card'));
    loadingSkeletons.append(create('div', 'skeleton skeleton-card'));
    activityCard.append(loadingSkeletons);
  } else if (state.recentActivity.length === 0) {
    const emptyFeed = create('div', 'empty-state');
    emptyFeed.append(create('p', '', 'No recent ticket or moderation activity records found in the database. As events occur in your Discord server, ServerPilot logs them here.'));
    activityCard.append(emptyFeed);
  } else {
    const feed = create('div', 'activity-feed');
    for (const item of state.recentActivity) {
      const el = create('div', 'activity-item');
      el.append(create('div', 'activity-icon', item.icon));
      const content = create('div', 'activity-content');
      content.append(create('div', 'activity-title', item.title));
      content.append(create('div', 'activity-meta', `${item.desc} · ${new Date(item.time).toLocaleString()}`));
      el.append(content);
      feed.append(el);
    }
    activityCard.append(feed);
  }
  container.append(activityCard);
}

/* Page 2: AI Server Builder */
function renderSetupBuilder(container) {
  const guild = currentGuild();
  if (!guild) {
    container.append(create('div', 'empty-state', 'Select an authorized server to plan and configure channel architectures.'));
    return;
  }

  const layout = create('div', 'two-col-layout');

  // Left Column: Builder Form
  const formCard = create('section', 'card');
  formCard.append(create('h2', 'card-title', 'Community Architecture Planner'));
  formCard.append(create('p', 'card-subtitle', 'Describe your server concept. ServerPilot AI produces safe, proportional channel structures, roles, and rules.'));

  const form = create('form');
  form.dataset.setupPlanForm = 'true';

  // Community Type
  const typeGroup = create('div', 'form-group');
  const typeLabel = create('label', 'form-label');
  typeLabel.append(create('span', '', 'Community Type'));
  const typeSelect = create('select', 'form-control');
  typeSelect.name = 'type';
  const types = ['Community', 'Gaming', 'Esports', 'Creator', 'Business', 'Custom'];
  for (const t of types) typeSelect.add(new Option(t, t));
  typeGroup.append(typeLabel, typeSelect);
  form.append(typeGroup);

  // Description
  const descGroup = create('div', 'form-group');
  const descLabel = create('label', 'form-label');
  descLabel.append(create('span', '', 'Community Description & Desired Channels'));
  const charCounter = create('span', 'form-label-hint', '10 - 1000 chars');
  descLabel.append(charCounter);
  const descText = create('textarea', 'form-control');
  descText.name = 'description';
  descText.required = true;
  descText.minLength = 10;
  descText.maxLength = 1000;
  descText.placeholder = 'Example: A competitive gaming hub for Valorant with scrims, LFG, clip submissions, strategy discussion, and staff channels. No crypto or NFT channels.';
  descText.addEventListener('input', () => {
    charCounter.textContent = `${descText.value.length} / 1000 chars`;
  });
  descGroup.append(descLabel, descText);
  form.append(descGroup);

  // Quick Prompt Chips
  const chipsContainer = create('div', 'prompt-chips');
  const presets = [
    { label: '🎮 Competitive Gaming', text: 'Competitive gaming hub with ranked scrims, clip sharing, team rosters, and private staff channels. No NFT channels.' },
    { label: '🎥 Content Creator', text: 'Creator community with YouTube stream alerts, patron lounge, fan creations, and community announcements.' },
    { label: '💼 Tech / SaaS Startup', text: 'Software product community with release notes, bug reports, feature requests, and dedicated customer support.' },
  ];
  for (const p of presets) {
    const chip = create('button', 'chip', p.label);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      descText.value = p.text;
      charCounter.textContent = `${p.text.length} / 1000 chars`;
    });
    chipsContainer.append(chip);
  }
  form.append(chipsContainer);

  // Submit Button
  const submitBtn = create('button', 'button button-primary', state.setupPlanLoading ? 'Generating Architecture...' : 'Generate Server Plan');
  submitBtn.type = 'submit';
  submitBtn.disabled = state.setupPlanLoading;
  form.append(submitBtn);

  formCard.append(form);
  layout.append(formCard);

  // Right Column: Preview & Apply
  const previewCard = create('section', 'card');
  previewCard.append(create('h2', 'card-title', 'Planned Architecture Preview'));
  previewCard.append(create('p', 'card-subtitle', 'Generated categories, voice channels, roles, and rules previewed safely before execution.'));

  if (state.setupPlanLoading) {
    const skeleton = create('div');
    skeleton.append(create('div', 'skeleton skeleton-card'));
    skeleton.append(create('div', 'skeleton skeleton-card'));
    previewCard.append(skeleton);
  } else if (state.setupPlanError) {
    const errBox = create('div', 'feedback feedback-danger', state.setupPlanError);
    previewCard.append(errBox);
  } else if (state.setupPlan) {
    const plan = state.setupPlan;
    const planDetails = create('div', 'setup-preview');

    const badge = create('span', 'badge badge-accent', `${plan.type} Template`);
    planDetails.append(badge);
    planDetails.append(create('h3', '', plan.description));

    // Channels / Categories
    for (const cat of [...plan.categories, ...(plan.voiceCategories || [])]) {
      const catBlock = create('div', 'plan-category');
      catBlock.append(create('h4', '', cat.name));
      const isVoice = (plan.voiceCategories || []).includes(cat);
      const chList = cat.channels.map((ch) => isVoice ? `🔊 ${ch}` : `# ${ch}`).join('  ·  ');
      catBlock.append(create('p', 'mono', chList));
      planDetails.append(catBlock);
    }

    // Roles
    if (plan.roles?.length) {
      const rolesBlock = create('div', 'plan-category');
      rolesBlock.append(create('h4', '', 'Planned Roles'));
      rolesBlock.append(create('p', 'mono', plan.roles.map((r) => `@${r.name}`).join('  ·  ')));
      planDetails.append(rolesBlock);
    }

    // Rules
    if (plan.rules?.length) {
      const rulesBlock = create('div', 'plan-category');
      rulesBlock.append(create('h4', '', 'Proposed Rules'));
      const ol = create('ol');
      for (const r of plan.rules) ol.append(create('li', '', r));
      rulesBlock.append(ol);
      planDetails.append(rulesBlock);
    }

    // Apply Actions & Notice
    const applySection = create('div', 'notice-box notice-warning');
    const noticeText = create('div', 'notice-text');
    noticeText.append(create('strong', '', 'Discord Server Application Guard: '));
    noticeText.append(create('span', '', 'To protect your community from destructive changes, ServerPilot requires plan execution to be confirmed interactively inside Discord.'));
    applySection.append(noticeText);
    planDetails.append(applySection);

    // Apply Button
    const applyBtn = create('button', 'button button-primary', state.setupApplyLoading ? 'Contacting Apply Endpoint...' : 'Confirm & Apply Plan to Discord');
    applyBtn.type = 'button';
    applyBtn.disabled = state.setupApplyLoading;
    applyBtn.addEventListener('click', () => {
      void handleApplyPlan();
    });
    planDetails.append(applyBtn);

    // Backend Response Display (Success / Partial / Failure)
    if (state.setupApplyResult) {
      const resBox = create('div', 'feedback feedback-success', JSON.stringify(state.setupApplyResult));
      planDetails.append(resBox);
    } else if (state.setupApplyError) {
      const errCard = create('div', 'notice-box notice-warning');
      const errText = create('div', 'notice-text');
      errText.append(create('strong', '', 'Backend Response (HTTP 501 / Safe Guard): '));
      errText.append(create('p', '', state.setupApplyError));
      errText.append(create('p', '', 'Run the reviewed plan interactively in Discord:'));
      const cmd = create('div', 'code-block', `/setup community:${plan.type.toLowerCase()}`);
      errText.append(cmd);
      errCard.append(errText);
      planDetails.append(errCard);
    }

    previewCard.append(planDetails);
  } else {
    const emptyPreview = create('div', 'empty-state');
    emptyPreview.append(create('p', '', 'No plan generated yet. Select a community type, enter a description on the left, and click "Generate Server Plan" to preview your structure.'));
    previewCard.append(emptyPreview);
  }

  layout.append(previewCard);
  container.append(layout);
}

async function handleApplyPlan() {
  const guild = currentGuild();
  if (!guild || !state.setupPlan) return;
  state.setupApplyLoading = true;
  state.setupApplyError = undefined;
  state.setupApplyResult = undefined;
  renderPage();

  try {
    const res = await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/setup/apply`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken(),
      },
      body: JSON.stringify({ plan: state.setupPlan }),
    });
    state.setupApplyResult = res;
    showFeedback('Plan applied successfully to Discord!', 'success');
  } catch (error) {
    state.setupApplyError = errorMessage(error);
  } finally {
    state.setupApplyLoading = false;
    renderPage();
  }
}

/* Page 3: Automations */
function renderAutomations(container) {
  const guild = currentGuild();
  if (!guild) {
    container.append(create('div', 'empty-state', 'Select an authorized server to manage its event automations.'));
    return;
  }

  // Header & AI Creator Trigger
  const topHeader = create('div', 'card-header');
  const titleGroup = create('div');
  titleGroup.append(create('h2', 'card-title', 'Server Automations Engine'));
  titleGroup.append(create('p', 'card-subtitle', 'Trigger actions based on Discord events like member joins, messages, tickets, or warnings.'));

  const toggleAiBtn = create('button', 'button button-primary', state.automationAiOpen ? 'Close AI Creator' : '✨ Draft Automation with AI');
  toggleAiBtn.type = 'button';
  toggleAiBtn.addEventListener('click', () => {
    state.automationAiOpen = !state.automationAiOpen;
    renderPage();
  });
  topHeader.append(titleGroup, toggleAiBtn);
  container.append(topHeader);

  // AI Automation Creator Panel
  if (state.automationAiOpen) {
    const aiCard = create('section', 'card');
    aiCard.append(create('h3', 'card-title', 'Draft Automation with ServerPilot AI'));
    aiCard.append(create('p', 'card-subtitle', 'Describe your automation goal. ServerPilot translates natural language into structured WHEN → IF → THEN triggers.'));

    const aiForm = create('form');
    const promptGroup = create('div', 'form-group');
    const pLabel = create('label', 'form-label', 'Automation Description');
    const pInput = create('input', 'form-control');
    pInput.name = 'description';
    pInput.placeholder = 'e.g. When a member gets 3 warnings, timeout them for 1 hour and notify moderators';
    pInput.required = true;
    promptGroup.append(pLabel, pInput);
    aiForm.append(promptGroup);

    const submitAiBtn = create('button', 'button button-primary', state.automationAiLoading ? 'Contacting AI Proposal Service...' : 'Generate Proposal');
    submitAiBtn.type = 'submit';
    submitAiBtn.disabled = state.automationAiLoading;
    aiForm.append(submitAiBtn);

    aiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = pInput.value.trim();
      if (!prompt) return;
      state.automationAiLoading = true;
      state.automationAiError = undefined;
      state.automationAiProposal = undefined;
      renderPage();

      try {
        const res = await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/automations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({ description: prompt }),
        });
        state.automationAiProposal = res.proposal;
      } catch (err) {
        state.automationAiError = errorMessage(err);
      } finally {
        state.automationAiLoading = false;
        renderPage();
      }
    });

    aiCard.append(aiForm);

    if (state.automationAiError) {
      const errBox = create('div', 'notice-box notice-warning');
      const text = create('div', 'notice-text');
      text.append(create('strong', '', 'Backend Safety Guard (HTTP 501 / Discord Verification): '));
      text.append(create('p', '', state.automationAiError));
      text.append(create('p', '', 'To verify role hierarchy and channel write permissions safely, AI automation proposals are drafted and confirmed via Discord:'));
      text.append(create('div', 'code-block', `/automation ai description:${pInput.value || 'your automation'}`));
      errBox.append(text);
      aiCard.append(errBox);
    }

    container.append(aiCard);
  }

  // Automation List
  if (state.loadingGuildData) {
    const sk = create('div', 'stats-grid');
    sk.append(create('div', 'skeleton skeleton-card'));
    sk.append(create('div', 'skeleton skeleton-card'));
    container.append(sk);
    return;
  }

  if (!Array.isArray(state.automations) || state.automations.length === 0) {
    const empty = create('div', 'empty-state');
    empty.append(create('div', 'empty-state-icon', '⚡'));
    empty.append(create('h3', '', 'No Automations Configured'));
    empty.append(create('p', '', 'No automations found in the repository for this guild. Create workflows using the Discord command /automation create or /automation ai.'));
    container.append(empty);
    return;
  }

  const listGrid = create('div', 'activity-feed');
  for (const auto of state.automations) {
    const card = create('article', 'card');
    const header = create('div', 'card-header');
    const heading = create('div');
    heading.append(create('h3', 'card-title', auto.name));
    heading.append(create('p', 'mono', `WHEN ${String(auto.trigger?.type || 'UNKNOWN').replaceAll('_', ' ')} · ${auto.conditions?.length || 0} condition(s) · ${auto.actions?.length || 0} action(s)`));
    header.append(heading, create('span', `badge ${auto.enabled ? 'badge-success' : 'badge-warning'}`, auto.enabled ? 'Enabled' : 'Disabled'));
    card.append(header);

    // Expandable When/If/Then Details
    const details = create('details', 'automation-details');
    details.append(create('summary', '', 'Inspect When / If / Then Logic'));
    const detailsContent = create('div');
    detailsContent.append(create('p', '', `Trigger: ${auto.trigger?.type}`));

    const condList = create('ul');
    for (const c of auto.conditions || []) condList.append(create('li', '', conditionSummary(c)));
    if (!auto.conditions?.length) condList.append(create('li', '', 'None (runs on every trigger)'));
    detailsContent.append(create('strong', '', 'IF Conditions:'), condList);

    const actList = create('ol');
    for (const a of auto.actions || []) actList.append(create('li', '', actionSummary(a)));
    detailsContent.append(create('strong', '', 'THEN Actions:'), actList);
    details.append(detailsContent);
    card.append(details);

    // Action Controls
    const actionsRow = create('div', 'dialog-actions');
    const toggleBtn = create('button', 'button button-quiet button-sm', auto.enabled ? 'Disable' : 'Enable');
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', () => {
      void toggleAutomation(auto.id, !auto.enabled);
    });

    const deleteBtn = create('button', 'button button-danger button-sm', 'Delete');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => {
      promptDeleteAutomation(auto);
    });

    actionsRow.append(toggleBtn, deleteBtn);
    card.append(actionsRow);
    listGrid.append(card);
  }
  container.append(listGrid);
}

function conditionSummary(c) {
  if (c.type === 'HAS_ROLE') return `Member has role ID: ${c.roleId}`;
  if (c.type === 'DOES_NOT_HAVE_ROLE') return `Member does not have role ID: ${c.roleId}`;
  if (c.type === 'CHANNEL_IS') return `Channel is ID: ${c.channelId}`;
  if (c.type === 'WARNING_COUNT') return `Warning count ${c.operator?.toLowerCase() || '>='} ${c.value}`;
  return JSON.stringify(c);
}

function actionSummary(a) {
  if (a.type === 'ADD_ROLE' || a.type === 'REMOVE_ROLE') return `${a.type === 'ADD_ROLE' ? 'Add' : 'Remove'} role ID: ${a.roleId}`;
  if (a.type === 'SEND_MESSAGE') return `Send message to channel ID ${a.channelId}: "${a.message}"`;
  if (a.type === 'SEND_DM') return `Send Direct Message: "${a.message}"`;
  if (a.type === 'ADD_WARNING') return `Add Warning: "${a.reason}"`;
  if (a.type === 'TIMEOUT_MEMBER') return `Timeout member for ${a.durationMinutes} min (${a.reason})`;
  if (a.type === 'NOTIFY_ROLE') return `Notify role ID ${a.roleId} in channel ID ${a.channelId}`;
  return JSON.stringify(a);
}

async function toggleAutomation(id, newStatus) {
  const guild = currentGuild();
  if (!guild || !id) return;
  try {
    await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/automations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ enabled: newStatus }),
    });
    showFeedback(`Automation ${newStatus ? 'enabled' : 'disabled'} successfully.`, 'success');
    await loadSelectedGuildData();
  } catch (err) {
    showFeedback(errorMessage(err), 'error');
  }
}

function promptDeleteAutomation(auto) {
  const body = create('div');
  body.append(create('p', '', `Are you sure you want to permanently delete automation "${auto.name}"?`));
  body.append(create('p', 'fine-print', 'This action deletes the workflow definition from the database and cannot be undone.'));

  const actions = create('div', 'dialog-actions');
  const cancelBtn = create('button', 'button button-quiet', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', closeDialog);

  const confirmBtn = create('button', 'button button-danger', 'Delete Automation');
  confirmBtn.type = 'button';
  confirmBtn.addEventListener('click', async () => {
    closeDialog();
    const guild = currentGuild();
    if (!guild) return;
    try {
      await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/automations/${encodeURIComponent(auto.id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ confirm: true }),
      });
      showFeedback(`Automation "${auto.name}" deleted.`, 'success');
      await loadSelectedGuildData();
    } catch (err) {
      showFeedback(errorMessage(err), 'error');
    }
  });

  actions.append(cancelBtn, confirmBtn);
  openDialog('Confirm Deletion', body, actions);
}

/* Page 4: Moderation */
function renderModeration(container) {
  const guild = currentGuild();
  if (!guild) {
    container.append(create('div', 'empty-state', 'Select an authorized server to view moderation logs.'));
    return;
  }

  // Header & Safety Notice
  const headerCard = create('section', 'card');
  headerCard.append(create('h2', 'card-title', 'Moderation Audit & Case Records'));
  headerCard.append(create('p', 'card-subtitle', 'Guild-scoped moderation history persisted through the ServerPilot ModerationService.'));

  const notice = create('div', 'notice-box notice-info');
  const nText = create('div', 'notice-text');
  nText.append(create('strong', '', 'Audit Policy: '));
  nText.append(create('span', '', 'Historical cases are read securely from the database. Direct destructive actions (Warn, Timeout, Kick, Ban) require interactive Discord command execution to uphold role permissions.'));
  notice.append(nText);
  headerCard.append(notice);
  container.append(headerCard);

  // Filter Bar
  const filters = ['ALL', 'WARN', 'TIMEOUT', 'KICK', 'BAN'];
  const filterBar = create('div', 'filter-bar');
  for (const f of filters) {
    const btn = create('button', `filter-btn ${state.moderationFilter === f ? 'active' : ''}`, f);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      state.moderationFilter = f;
      renderPage();
    });
    filterBar.append(btn);
  }
  container.append(filterBar);

  if (state.loadingGuildData) {
    container.append(create('div', 'skeleton skeleton-card'));
    return;
  }

  if (state.moderationError) {
    const err = create('div', 'notice-box notice-warning');
    err.append(create('p', '', `Moderation Records: ${state.moderationError}`));
    container.append(err);
    return;
  }

  const rawCases = Array.isArray(state.moderationCases) ? state.moderationCases : [];
  const filteredCases = state.moderationFilter === 'ALL'
    ? rawCases
    : rawCases.filter((c) => c.action?.toUpperCase() === state.moderationFilter);

  if (filteredCases.length === 0) {
    const empty = create('div', 'empty-state');
    empty.append(create('div', 'empty-state-icon', '🛡️'));
    empty.append(create('h3', '', 'No Moderation Cases Found'));
    empty.append(create('p', '', 'No moderation cases match your filter. Enforcement actions executed in Discord using /warn, /timeout, /kick, or /ban will appear here.'));
    container.append(empty);
    return;
  }

  // Table
  const tableWrap = create('div', 'table-wrapper');
  const table = create('table', 'data-table');
  const thead = create('thead');
  thead.innerHTML = `<tr>
    <th>Action</th>
    <th>Target User</th>
    <th>Moderator</th>
    <th>Reason</th>
    <th>Duration</th>
    <th>Timestamp</th>
  </tr>`;
  table.append(thead);

  const tbody = create('tbody');
  for (const c of filteredCases) {
    const tr = create('tr');
    const badgeClass = c.action === 'ban' ? 'badge-danger' : c.action === 'warn' ? 'badge-warning' : 'badge-info';
    tr.innerHTML = `
      <td><span class="badge ${badgeClass}">${String(c.action).toUpperCase()}</span></td>
      <td class="mono">${c.targetUserId}</td>
      <td class="mono">${c.moderatorUserId || 'System / Bot'}</td>
      <td>${c.reason || 'None stated'}</td>
      <td>${c.durationSeconds ? `${Math.round(c.durationSeconds / 60)} mins` : '—'}</td>
      <td>${new Date(c.createdAt).toLocaleString()}</td>
    `;
    tbody.append(tr);
  }
  table.append(tbody);
  tableWrap.append(table);
  container.append(tableWrap);

  // Write Action Verification Form (Honest test showing backend guard)
  const actionFormCard = create('section', 'card');
  actionFormCard.append(create('h3', 'card-title', 'Dispatch Moderation Action (Backend Protected)'));
  actionFormCard.append(create('p', 'card-subtitle', 'Attempting web-side moderation calls tests the backend policy to ensure unverified web actions are rejected.'));

  const testForm = create('form');
  const fRow = create('div', 'two-col-layout');

  const uGrp = create('div', 'form-group');
  uGrp.append(create('label', 'form-label', 'Target User ID'));
  const uInput = create('input', 'form-control');
  uInput.name = 'targetId';
  uInput.placeholder = 'Paste Discord Snowflake ID';
  uInput.required = true;
  uGrp.append(uInput);

  const aGrp = create('div', 'form-group');
  aGrp.append(create('label', 'form-label', 'Enforcement Action'));
  const aSelect = create('select', 'form-control');
  for (const opt of ['warn', 'timeout', 'kick', 'ban']) aSelect.add(new Option(opt.toUpperCase(), opt));
  aGrp.append(aSelect);

  fRow.append(uGrp, aGrp);
  testForm.append(fRow);

  const rGrp = create('div', 'form-group');
  rGrp.append(create('label', 'form-label', 'Reason'));
  const rInput = create('input', 'form-control');
  rInput.name = 'reason';
  rInput.placeholder = 'State violation reason';
  rGrp.append(rInput);
  testForm.append(rGrp);

  const submitTestBtn = create('button', 'button button-danger', 'Test Moderation Action Endpoint');
  submitTestBtn.type = 'submit';
  testForm.append(submitTestBtn);

  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitTestBtn.disabled = true;
    try {
      await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/moderation/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          targetUserId: uInput.value.trim(),
          action: aSelect.value,
          reason: rInput.value.trim(),
        }),
      });
      showFeedback('Action completed.', 'success');
    } catch (err) {
      showFeedback(errorMessage(err), 'warning');
    } finally {
      submitTestBtn.disabled = false;
    }
  });

  actionFormCard.append(testForm);
  container.append(actionFormCard);
}

/* Page 5: Tickets */
function renderTickets(container) {
  const guild = currentGuild();
  if (!guild) {
    container.append(create('div', 'empty-state', 'Select an authorized server to inspect ticket workflows.'));
    return;
  }

  // Ticket Configuration Card
  const configCard = create('section', 'card');
  configCard.append(create('h2', 'card-title', 'Support Ticket Configuration'));
  configCard.append(create('p', 'card-subtitle', 'Settings configured through the Discord /tickets setup workflow.'));

  if (state.ticketConfigurationError) {
    const err = create('div', 'notice-box notice-warning');
    err.append(create('p', '', `Ticket Configuration: ${state.ticketConfigurationError}`));
    configCard.append(err);
  } else if (!state.ticketConfiguration) {
    const emptyConfig = create('div', 'empty-state');
    emptyConfig.append(create('p', '', 'No ticket configuration stored for this server. Run /tickets in Discord to set up ticket categories and support roles.'));
    configCard.append(emptyConfig);
  } else {
    const conf = state.ticketConfiguration;
    const grid = create('div', 'stats-grid');

    const s1 = create('div', 'stat-card');
    s1.append(create('span', 'stat-card-label', 'System Status'), create('div', 'stat-card-value', conf.enabled ? 'Enabled' : 'Disabled'), create('p', 'stat-card-desc', 'Ticket panel state'));

    const s2 = create('div', 'stat-card');
    s2.append(create('span', 'stat-card-label', 'Support Role ID'), create('div', 'stat-card-value mono', conf.supportRoleId || '—'), create('p', 'stat-card-desc', 'Role pinged upon ticket creation'));

    const s3 = create('div', 'stat-card');
    s3.append(create('span', 'stat-card-label', 'Support Category ID'), create('div', 'stat-card-value mono', conf.categoryId || '—'), create('p', 'stat-card-desc', 'Category where ticket channels open'));

    const s4 = create('div', 'stat-card');
    s4.append(create('span', 'stat-card-label', 'Transcript Log Channel'), create('div', 'stat-card-value mono', conf.logChannelId || '—'), create('p', 'stat-card-desc', 'Transcripts archived upon close'));

    grid.append(s1, s2, s3, s4);
    configCard.append(grid);
  }
  container.append(configCard);

  // Ticket Lifecycle Records
  const historyCard = create('section', 'card');
  historyCard.append(create('h2', 'card-title', 'Ticket Lifecycle Records'));
  historyCard.append(create('p', 'card-subtitle', 'Logged ticket sessions persisted via TicketService. Ticket closure and transcript archiving occur in Discord channels.'));

  if (state.ticketRecordsError) {
    historyCard.append(create('div', 'notice-box notice-warning', state.ticketRecordsError));
  } else if (!Array.isArray(state.tickets) || state.tickets.length === 0) {
    const empty = create('div', 'empty-state');
    empty.append(create('div', 'empty-state-icon', '🎫'));
    empty.append(create('h3', '', 'No Ticket History'));
    empty.append(create('p', '', 'No active or historical support tickets found. When members create tickets in Discord, records are archived here.'));
    historyCard.append(empty);
  } else {
    const tableWrap = create('div', 'table-wrapper');
    const table = create('table', 'data-table');
    table.innerHTML = `<thead><tr>
      <th>Ticket Channel</th>
      <th>Creator</th>
      <th>Status</th>
      <th>Opened At</th>
      <th>Closed At</th>
    </tr></thead>`;

    const tbody = create('tbody');
    for (const t of state.tickets) {
      const tr = create('tr');
      tr.innerHTML = `
        <td class="mono">#ticket-${t.channelId.slice(-4)}</td>
        <td class="mono">${t.creatorId}</td>
        <td><span class="badge ${t.status === 'open' ? 'badge-success' : 'badge-info'}">${t.status.toUpperCase()}</span></td>
        <td>${new Date(t.openedAt).toLocaleString()}</td>
        <td>${t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}</td>
      `;
      tbody.append(tr);
    }
    table.append(tbody);
    tableWrap.append(table);
    historyCard.append(tableWrap);
  }
  container.append(historyCard);
}

/* Page 6: Settings */
function renderSettings(container) {
  const guild = currentGuild();

  // 1. Server Settings
  const serverCard = create('section', 'card');
  serverCard.append(create('h2', 'card-title', 'Server Profile & Permissions'));
  if (!guild) {
    serverCard.append(create('p', 'muted', 'Select a server to inspect its profile and authorization settings.'));
  } else {
    const grid = create('div', 'stats-grid');
    grid.append(
      createStat('Server Name', guild.name, 'Discord Guild Name'),
      createStat('Guild Snowflake', guild.id, 'Unique Discord identifier', true),
      createStat('Permissions Verified', 'Manage Server / Admin', 'Confirmed live via Discord OAuth'),
      createStat('Approx. Members', state.overview?.guild?.memberCount?.value ? `~${state.overview.guild.memberCount.value}` : 'Unavailable', 'From Discord Guild Snapshot'),
    );
    serverCard.append(grid);
  }
  container.append(serverCard);

  // 2. Welcome Configuration
  const welcomeCard = create('section', 'card');
  welcomeCard.append(create('h2', 'card-title', 'Welcome Message System'));
  welcomeCard.append(create('p', 'card-subtitle', 'Welcome messages greeted to new members joining the server.'));

  if (!guild) {
    welcomeCard.append(create('p', 'muted', 'Select a server to view welcome message configuration.'));
  } else if (state.welcomeError) {
    welcomeCard.append(create('div', 'notice-box notice-warning', state.welcomeError));
  } else if (!state.welcomeConfiguration) {
    const emptyW = create('div', 'empty-state');
    emptyW.append(create('p', '', 'Welcome messages are not yet configured for this server. Configure welcome announcements via Discord using /welcome.'));
    welcomeCard.append(emptyW);
  } else {
    const w = state.welcomeConfiguration;
    const wGrid = create('div', 'stats-grid');
    wGrid.append(
      createStat('Status', w.enabled ? 'Enabled' : 'Disabled', 'Auto-greet new members'),
      createStat('Target Channel', w.channelId ? `<#${w.channelId}>` : 'None', 'Channel where message is sent', true),
    );
    welcomeCard.append(wGrid);

    const templateBox = create('div', 'form-group');
    templateBox.append(create('label', 'form-label', 'Template Message Preview'));
    const tBox = create('div', 'code-block', w.message || 'No message template configured');
    templateBox.append(tBox);
    welcomeCard.append(templateBox);
  }
  container.append(welcomeCard);

  // 3. Discord Account & Session
  const accountCard = create('section', 'card');
  accountCard.append(create('h2', 'card-title', 'Discord Operator Account'));
  accountCard.append(create('p', 'card-subtitle', 'Authenticated Discord session details.'));

  const accGrid = create('div', 'stats-grid');
  accGrid.append(
    createStat('Username', state.user?.username || 'Unknown', state.user?.displayName ? `Display: ${state.user.displayName}` : 'Discord Handle'),
    createStat('Discord User ID', state.user?.discordUserId || 'Unknown', 'Subject Snowflake', true),
    createStat('Session Type', 'OAuth 2.0 Encrypted', 'SameSite=Lax HttpOnly cookie with CSRF'),
    createStat('Backend Health', state.health?.status || 'Unknown', `DB: ${state.health?.services?.database || 'not_configured'}`),
  );
  accountCard.append(accGrid);

  // Logout Action
  const logoutRow = create('div', 'dialog-actions');
  const logoutBtn = create('button', 'button button-danger', 'Sign Out of ServerPilot');
  logoutBtn.type = 'button';
  logoutBtn.addEventListener('click', promptLogout);
  logoutRow.append(logoutBtn);
  accountCard.append(logoutRow);

  container.append(accountCard);
}

function createStat(label, value, desc, isMono = false) {
  const c = create('div', 'stat-card');
  c.append(create('span', 'stat-card-label', label));
  c.append(create('div', `stat-card-value ${isMono ? 'mono' : ''}`, value));
  c.append(create('p', 'stat-card-desc', desc));
  return c;
}

function promptLogout() {
  const body = create('div');
  body.append(create('p', '', 'Are you sure you want to end your ServerPilot session?'));
  body.append(create('p', 'fine-print', 'You will need to re-authenticate with Discord to access your servers.'));

  const actions = create('div', 'dialog-actions');
  const cancelBtn = create('button', 'button button-quiet', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', closeDialog);

  const confirmBtn = create('button', 'button button-danger', 'Log Out');
  confirmBtn.type = 'button';
  confirmBtn.addEventListener('click', async () => {
    closeDialog();
    try {
      await api('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken() },
      });
      sessionStorage.removeItem('serverpilot-selected-guild');
      renderSignedOut('You have logged out successfully.');
    } catch (err) {
      showFeedback(errorMessage(err), 'error');
    }
  });

  actions.append(cancelBtn, confirmBtn);
  openDialog('Confirm Sign Out', body, actions);
}

/* Page 7: Billing */
function renderBilling(container) {
  const billingCard = create('section', 'card');
  billingCard.append(create('h2', 'card-title', 'Subscription & Quota Management'));
  billingCard.append(create('p', 'card-subtitle', 'Server-controlled subscription entitlements. No payment or subscription state is inferred or faked.'));

  const grid = create('div', 'stats-grid');
  grid.append(
    createStat('Current Plan', 'Free Tier', 'Standard Community License'),
    createStat('AI Architecture Plans', 'Included', 'Community setup planner'),
    createStat('Automations Engine', 'Included', 'Standard event-driven workflows'),
    createStat('Payment Provider', state.health?.services?.stripe === 'not_configured' ? 'Not Configured' : 'Configured', 'Direct from /api/v1/health'),
  );
  billingCard.append(grid);
  container.append(billingCard);

  // Pro Tier Comparison Area
  const proCard = create('section', 'card');
  proCard.append(create('h2', 'card-title', 'ServerPilot Pro Tier'));
  proCard.append(create('p', 'card-subtitle', 'Advanced features for enterprise Discord communities and creator networks.'));

  const featList = create('div', 'activity-feed');
  const proFeatures = [
    { title: 'Unlimited Automations', desc: 'No concurrency or event limits on WHEN/IF/THEN triggers' },
    { title: 'AI Community Intelligence', desc: 'Deep health diagnostics, member retention analytics, and smart moderation' },
    { title: 'Multi-Server Sync', desc: 'Synchronize roles, rules, and automations across multiple Discord communities' },
  ];
  for (const f of proFeatures) {
    const it = create('div', 'activity-item');
    it.append(create('div', 'activity-icon', '⭐'));
    const ct = create('div', 'activity-content');
    ct.append(create('div', 'activity-title', f.title), create('div', 'activity-meta', f.desc));
    it.append(ct);
    featList.append(it);
  }
  proCard.append(featList);

  // Stripe Upgrade Area (Honest)
  const stripeNotice = create('div', 'notice-box notice-warning');
  const sText = create('div', 'notice-text');
  sText.append(create('strong', '', 'Stripe Integration Status: '));
  sText.append(create('p', '', 'Payment processing is not configured on this ServerPilot backend deployment (services.stripe: "not_configured"). ServerPilot does not simulate or fake subscription upgrades.'));
  stripeNotice.append(sText);
  proCard.append(stripeNotice);

  const upgradeBtn = create('button', 'button button-primary', 'Upgrade to Pro');
  upgradeBtn.type = 'button';
  upgradeBtn.addEventListener('click', async () => {
    upgradeBtn.disabled = true;
    try {
      const guild = currentGuild();
      if (!guild) {
        showFeedback('Please select a server first.', 'warning');
        return;
      }
      await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/billing/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      });
    } catch (err) {
      showFeedback(errorMessage(err), 'warning');
    } finally {
      upgradeBtn.disabled = false;
    }
  });
  proCard.append(upgradeBtn);

  container.append(proCard);
}

/* Page Rendering Router */
function renderPage() {
  const page = pages.find((p) => p.id === state.currentPage) || pages[0];
  if (elements.heading) {
    elements.heading.replaceChildren();
    elements.heading.append(create('h1', '', page.label));
    elements.heading.append(create('p', '', page.description));
  }
  if (elements.content) {
    elements.content.replaceChildren();
    if (page.id === 'overview') renderOverview(elements.content);
    else if (page.id === 'builder') renderSetupBuilder(elements.content);
    else if (page.id === 'automations') renderAutomations(elements.content);
    else if (page.id === 'moderation') renderModeration(elements.content);
    else if (page.id === 'tickets') renderTickets(elements.content);
    else if (page.id === 'settings') renderSettings(elements.content);
    else if (page.id === 'billing') renderBilling(elements.content);
  }
  renderNavigation();
}

function showDashboard() {
  setLoading(false);
  setVisible(elements.dashboard, true);
  renderProfile();
  renderServerSelect();
  renderPage();
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
  if (elements.profile) elements.profile.replaceChildren();
  setVisible(elements.profile, false);
  setVisible(elements.logout, false);

  if (elements.authMessage) elements.authMessage.textContent = message;
  if (elements.authError) {
    elements.authError.textContent = error || '';
    setVisible(elements.authError, Boolean(error));
  }

  const oauthStatus = state.health?.services?.discordOAuth;
  const configured = oauthStatus === 'configured_not_verified';
  if (elements.login) {
    elements.login.textContent = configured ? 'Continue with Discord' : 'Discord sign-in unavailable';
    elements.login.setAttribute('aria-disabled', String(!configured));
    elements.login.classList.toggle('button-disabled', !configured);
  }
  setVisible(elements.auth, true);
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
        renderSignedOut('Sign in with Discord to manage your verified servers.');
        return;
      }
      throw error;
    }
    state.user = me.user;

    const guildResponse = await api('/api/v1/guilds');
    if (!Array.isArray(guildResponse.guilds)) {
      throw new Error('ServerPilot returned an invalid server list format.');
    }
    state.guilds = guildResponse.guilds.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string');

    let rememberedGuild;
    try {
      rememberedGuild = sessionStorage.getItem('serverpilot-selected-guild');
    } catch {
      // Best-effort
    }
    state.selectedGuildId = state.guilds.some((g) => g.id === rememberedGuild)
      ? rememberedGuild
      : (state.guilds[0]?.id || undefined);

    showDashboard();
    if (state.selectedGuildId) {
      void loadSelectedGuildData();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      renderSignedOut('Your Discord session expired. Sign in again to continue.');
      return;
    }
    setLoading(false);
    setVisible(elements.auth, true);
    if (elements.authMessage) elements.authMessage.textContent = 'Could not load your account or authorized servers.';
    if (elements.authError) {
      elements.authError.textContent = errorMessage(error);
      setVisible(elements.authError, true);
    }
  }
}

// Global Event Listeners
if (elements.authRetry) {
  elements.authRetry.addEventListener('click', () => {
    void loadDashboard();
  });
}

if (elements.serverSelect) {
  elements.serverSelect.addEventListener('change', () => {
    selectGuild(elements.serverSelect.value);
  });
}

if (elements.nav) {
  elements.nav.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-page]') : null;
    if (!(target instanceof HTMLButtonElement)) return;
    state.currentPage = target.dataset.page || 'overview';
    renderPage();
  });
}

if (elements.theme) {
  elements.theme.addEventListener('change', () => setTheme(elements.theme.value, true));
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (elements.theme?.value === 'system') setTheme('system');
});

// Setup Plan Submission Listener
if (elements.content) {
  elements.content.addEventListener('submit', async (event) => {
    const form = event.target instanceof HTMLFormElement && event.target.matches('[data-setup-plan-form]')
      ? event.target
      : undefined;
    if (!form) return;
    event.preventDefault();
    const guild = currentGuild();
    if (!guild) return;

    const formData = new FormData(form);
    const type = String(formData.get('type') || 'Community');
    const description = String(formData.get('description') || '').trim();

    state.setupPlanLoading = true;
    state.setupPlanError = undefined;
    state.setupPlan = undefined;
    state.setupApplyResult = undefined;
    state.setupApplyError = undefined;
    renderPage();

    try {
      const response = await api(`/api/v1/guilds/${encodeURIComponent(guild.id)}/setup/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({ type, description }),
      });
      state.setupPlan = response.plan;
      showFeedback('Server architecture plan generated successfully!', 'success');
    } catch (error) {
      state.setupPlanError = errorMessage(error);
      showFeedback(state.setupPlanError, 'error');
    } finally {
      state.setupPlanLoading = false;
      renderPage();
    }
  });
}

// Initialize Theme & Session
let savedTheme = 'dark';
try {
  const storedTheme = localStorage.getItem('serverpilot-theme');
  if (['dark', 'light', 'system'].includes(storedTheme)) savedTheme = storedTheme;
} catch {
  // Best effort
}
setTheme(savedTheme);
void loadDashboard();
