import { getTemplate } from './templates.js';
import { createRolePlan } from './role-planner.js';
import type { SetupAnswers, SetupCategory, SetupPlan, SetupQuestion, SetupType } from './types.js';

type Feature = {
  id: string;
  label: string;
  keywords: string[];
  category: SetupCategory;
  voice?: string[];
};

export type SetupIntent = {
  approximateSize?: number;
  scale: 'small' | 'medium' | 'large' | 'very-large' | 'unspecified';
  tone?: string;
  moderationPreference: 'light' | 'strict' | 'standard' | 'unspecified';
  requestedFeatures: string[];
  excludedFeatures: string[];
  requestedChannels: string[];
  excludedChannels: string[];
  playerRecruitmentRequested: boolean;
  separateSupportChannelRequested: boolean;
  gameNames: string[];
  onlyRequestedFeatures: boolean;
  minimal: boolean;
  rulesPreference: 'include' | 'exclude' | 'unspecified';
  voiceChannelCount?: number;
};

const featureCatalog: Feature[] = [
  { id: 'voice', label: 'voice channels', keywords: ['voice', 'voice channel', 'voice channels', 'vc', 'voice chat'], category: { name: '🔊 VOICE', channels: ['General'] }, voice: ['General'] },
  { id: 'support', label: 'support', keywords: ['support', 'help desk', 'customer support', 'support team'], category: { name: '🛠️ SUPPORT', channels: ['support'] } },
  { id: 'tickets', label: 'ticket channel', keywords: ['ticket', 'tickets'], category: { name: '🛠️ SUPPORT', channels: ['tickets'] } },
  { id: 'events', label: 'events', keywords: ['event', 'events', 'game night', 'game nights'], category: { name: '📅 EVENTS', channels: ['events'] } },
  { id: 'tournaments', label: 'tournaments', keywords: ['tournament', 'tournaments', 'scrim', 'scrims', 'match results'], category: { name: '🏆 TOURNAMENTS', channels: ['tournaments'] } },
  { id: 'media', label: 'content sharing', keywords: ['media', 'content sharing', 'content discussion', 'feedback', 'video sharing', 'sharing videos', 'videos'], category: { name: '🎬 CONTENT', channels: ['content-discussion', 'feedback', 'video-sharing'] } },
  { id: 'clips', label: 'clips', keywords: ['clip', 'clips', 'highlights'], category: { name: '🎬 CONTENT', channels: ['clips'] } },
  { id: 'build-showcase', label: 'build showcase', keywords: ['build showcase', 'show builds', 'share builds', 'post builds', 'showcase builds', 'builders showcase', 'minecraft builds', 'builds'], category: { name: '🎮 MINECRAFT', channels: ['build-showcase'] } },
  { id: 'general', label: 'general chat', keywords: ['general', 'general chat', 'talk', 'chat'], category: { name: '💬 COMMUNITY', channels: ['general'] } },
  { id: 'announcements', label: 'announcements', keywords: ['announcement', 'announcements'], category: { name: '📢 INFORMATION', channels: ['announcements'] } },
  { id: 'rules', label: 'rules', keywords: ['rules', 'rules channel'], category: { name: '📢 INFORMATION', channels: ['rules'] } },
  { id: 'lfg', label: 'LFG', keywords: ['lfg', 'looking for group', 'looking-for-group', 'find players'], category: { name: '🎮 GAMING', channels: ['looking-for-group'] } },
  { id: 'teams', label: 'team areas', keywords: ['team', 'teams', 'team areas', 'roster'], category: { name: '🏆 COMPETITION', channels: ['teams'] } },
  { id: 'scrims', label: 'scrims and match results', keywords: ['scrim', 'scrims', 'match results'], category: { name: '🏆 COMPETITION', channels: ['scrims', 'match-results'] } },
  { id: 'vip', label: 'VIP/supporter area', keywords: ['vip', 'supporter', 'supporters', 'patron', 'premium'], category: { name: '⭐ SUPPORTERS', channels: ['supporter-chat'] } },
  { id: 'faq', label: 'FAQs', keywords: ['faq', 'faqs', 'frequently asked'], category: { name: '📢 INFORMATION', channels: ['faqs'] } },
  { id: 'giveaways', label: 'giveaways', keywords: ['giveaway', 'giveaways'], category: { name: '🎁 GIVEAWAYS', channels: ['giveaways'] } },
  { id: 'trading', label: 'trading/economy', keywords: ['trade', 'trades', 'trading', 'economy', 'marketplace'], category: { name: '💱 TRADING', channels: ['trading'] } },
  { id: 'applications', label: 'staff applications', keywords: ['application', 'applications', 'staff application', 'staff applications', 'staff-applications'], category: { name: '🛠️ STAFF', channels: ['staff-applications'] } },
  { id: 'resources', label: 'resources', keywords: ['resource', 'resources', 'guides', 'documentation'], category: { name: '📚 RESOURCES', channels: ['resources'] } },
  { id: 'onboarding', label: 'onboarding', keywords: ['onboarding', 'getting started', 'start here', 'start-here'], category: { name: '👋 ONBOARDING', channels: ['start-here'] } },
  { id: 'staff-area', label: 'staff area', keywords: ['staff area', 'staff areas', 'staff channels', 'private staff'], category: { name: '🛠️ STAFF', channels: ['staff-chat'] } },
];

const questionCatalog: Record<SetupType, SetupQuestion[]> = {
  Gaming: [
    { id: 'voice', label: 'Would you like voice channels?', feature: 'voice' },
    { id: 'lfg', label: 'Would you like a looking-for-group section?', feature: 'lfg' },
    { id: 'events', label: 'Would you like a simple events channel?', feature: 'events' },
    { id: 'media', label: 'Would you like a media/clips section?', feature: 'media' },
    { id: 'support', label: 'Would you like a support/ticket section?', feature: 'support' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
  Esports: [
    { id: 'tournaments', label: 'Would you like tournament channels?', feature: 'tournaments' },
    { id: 'teams', label: 'Would you like teams and player recruitment channels?', feature: 'teams' },
    { id: 'scrims', label: 'Would you like scrim and match result channels?', feature: 'scrims' },
    { id: 'voice', label: 'Would you like team voice channels?', feature: 'voice' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
  Creator: [
    { id: 'media', label: 'Would you like a dedicated clips/media section?', feature: 'media' },
    { id: 'vip', label: 'Would you like a supporter or VIP area?', feature: 'vip' },
    { id: 'support', label: 'Would you like a support section?', feature: 'support' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
  Community: [
    { id: 'events', label: 'Would you like a simple events channel?', feature: 'events' },
    { id: 'media', label: 'Would you like a media section?', feature: 'media' },
    { id: 'support', label: 'Would you like a support section?', feature: 'support' },
    { id: 'voice', label: 'Would you like voice channels?', feature: 'voice' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
  Business: [
    { id: 'support', label: 'Would you like support/ticket channels?', feature: 'support' },
    { id: 'faq', label: 'Would you like an FAQ channel?', feature: 'faq' },
    { id: 'giveaways', label: 'Would you like a giveaways section?', feature: 'giveaways' },
    { id: 'voice', label: 'Would you like business voice channels?', feature: 'voice' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
  Custom: [
    { id: 'voice', label: 'Would you like voice channels?', feature: 'voice' },
    { id: 'support', label: 'Would you like a support/ticket section?', feature: 'support' },
    { id: 'events', label: 'Would you like a simple events channel?', feature: 'events' },
    { id: 'media', label: 'Would you like a media section?', feature: 'media' },
    { id: 'applications', label: 'Would you like a staff applications channel?', feature: 'applications' },
  ],
};

const decideRecommendations: Record<SetupType, string[]> = {
  Gaming: ['voice', 'media'],
  Esports: ['tournaments', 'teams', 'scrims', 'voice'],
  Creator: ['media'],
  Community: ['media'],
  Business: ['support', 'faq'],
  Custom: ['support'],
};

const knownGames = ['fortnite', 'minecraft', 'valorant', 'league-of-legends', 'apex-legends', 'rocket-league', 'overwatch'];

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escapedKeyword}([^a-z0-9]|$)`, 'i').test(text);
  });
}

function explicitlyExcluded(text: string, keywords: string[]) {
  const clauses = text.toLowerCase().split(/[.!?;,\n]|\bbut\b|\bhowever\b|\bwhereas\b/);
  return clauses.some((clause) => keywords.some((keyword) => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+').replace(/\\-/g, '[-\\s]?');
    const negativePrefix = String.raw`(?:\bno\s+|\bwithout\s+|\bskip\s+|\bexclude\s+|\bleave\s+out\s+|\bnot\s+(?:\w+\s+){0,2}|\bno\s+need\s+(?:for\s+)?|\bdon't\s+(?:want|need|add|include|create|use)\s+(?:any\s+)?|\bdo\s+not\s+(?:want|need|add|include|create|use)\s+(?:any\s+)?|\bwe\s+don't\s+(?:use|need|want)\s+(?:any\s+)?|\bi\s+don't\s+(?:use|need|want)\s+(?:any\s+)?)\s*`;
    return new RegExp(`${negativePrefix}[^.!?;,:]{0,35}\\b${escapedKeyword}\\b`, 'i').test(clause);
  }));
}

export function extractSetupIntent(_type: SetupType, description: string): SetupIntent {
  const normalized = description.toLowerCase().replace(/[’]/g, "'");
  const naturalText = normalized.replace(/\bdont\b/g, "don't").replace(/\bdoesnt\b/g, "doesn't");
  const sizeMatch = naturalText.match(/\b(?:around|about|approximately|roughly|like|for|with)?\s*(\d{1,6})\s*(?:members?|people|mates|friends?|users?)\b/);
  const approximateSize = sizeMatch ? Number(sizeMatch[1]) : undefined;
  const requestedFeatures = featureCatalog.filter((feature) => hasAny(naturalText, feature.keywords) && !explicitlyExcluded(naturalText, feature.keywords)).map((feature) => feature.id);
  const excludedFeatures = featureCatalog.filter((feature) => explicitlyExcluded(naturalText, feature.keywords)).map((feature) => feature.id);
  const excludesStaffRoles = explicitlyExcluded(naturalText, ['staff team', 'staff roles', 'moderators', 'moderator', 'staff'])
    || /\bno complicated roles\b|\bno complicated staff\b/i.test(naturalText);
  if (excludesStaffRoles) excludedFeatures.push('staff-roles');
  const voiceCountMatch = naturalText.match(/\b(\d+|one|two|three|several|multiple)\s+voice\s+channels?\b/);
  const voiceChannelCount = voiceCountMatch
    ? Math.min(10, Math.max(1, /^\d+$/.test(voiceCountMatch[1] ?? '') ? Number(voiceCountMatch[1]) : ({ one: 1, two: 2, three: 3 } as Record<string, number>)[voiceCountMatch[1] ?? ''] ?? 3))
    : undefined;
  const rulesPreference = explicitlyExcluded(naturalText, ['rules channel', 'rules'])
    ? 'exclude'
    : hasAny(naturalText, ['rules channel', 'create rules', 'rules'])
      ? 'include'
      : 'unspecified';
  const scale = approximateSize === undefined ? 'unspecified' : approximateSize <= 50 ? 'small' : approximateSize <= 250 ? 'medium' : approximateSize <= 1000 ? 'large' : 'very-large';
  const smallCommunity = /\b(?:small|tiny|private|close-knit|close knit|just me and|just us|a few friends|mates)\b/i.test(naturalText);
  const tone = ['chill', 'relaxed', 'casual', 'friendly', 'professional', 'serious', 'competitive', 'family-friendly', 'developer-focused', 'creator-focused', 'esports-focused']
    .find((candidate) => hasAny(naturalText, [candidate]));
  const moderationPreference = /\b(?:light|lightweight|relaxed)\s+moderation\b|\bkeep moderation light\b/i.test(naturalText)
    ? 'light'
    : /\b(?:strict|tough|strong)\s+moderation\b|\bmoderation (?:is )?strict\b/i.test(naturalText)
      ? 'strict'
      : hasAny(naturalText, ['moderation']) ? 'standard' : 'unspecified';
  const minimal = /\b(?:simple|basic|minimal|keep it simple|keep it minimal|nothing over the top|not over the top|don't make it (?:some )?massive|do not make it (?:some )?massive|don't overdo it|do not overdo it|nothing fancy|nothing too complicated|not too complicated|really basic|lightweight)\b/i.test(naturalText);
  const onlyRequestedFeatures = /\b(?:only|just)\s+(?:need|want|include|create|have|for|these|the following)\b|\bdon't add anything else\b|\bdo not add anything else\b|\bnothing else\b/i.test(naturalText);
  const smallFriendsGroup = /\b(?:just|only)\s+(?:for\s+)?(?:me|us)\s+and\s+\d+\s+(?:mates|friends)\b/i.test(naturalText);
  const gameNames = knownGames.filter((game) => hasAny(naturalText, [game.replaceAll('-', ' '), game]));
  const requestedChannels = parseNamedChannels(naturalText).filter((channel) => !explicitlyExcluded(naturalText, [channel.replaceAll('-', ' '), channel]));
  const excludedChannels = parseNamedChannels(naturalText).filter((channel) => explicitlyExcluded(naturalText, [channel.replaceAll('-', ' '), channel]));
  const playerRecruitmentRequested = hasAny(naturalText, [
    'player recruitment', 'recruit players', 'recruiting players', 'player applications',
    'team recruitment', 'joining teams', 'join teams', 'join a team', 'apply to join teams',
    'tryout', 'tryouts', 'try-out', 'try-outs',
  ]);
  const withoutSupportTicketPhrase = naturalText.replace(/\bsupport\s+tickets?\b|\btickets?\s+support\b/g, '');
  const separateSupportChannelRequested = hasAny(withoutSupportTicketPhrase, [
    'support', 'support channel', 'support information', 'support info', 'support desk',
  ]);
  return {
    ...(approximateSize === undefined ? {} : { approximateSize }),
    scale: scale === 'unspecified' && smallCommunity ? 'small' : scale,
    ...(tone ? { tone } : {}),
    moderationPreference,
    requestedFeatures,
    excludedFeatures,
    requestedChannels,
    excludedChannels,
    playerRecruitmentRequested,
    separateSupportChannelRequested,
    gameNames,
    onlyRequestedFeatures: onlyRequestedFeatures || smallFriendsGroup,
    minimal: minimal || smallFriendsGroup || smallCommunity && /\b(?:chill|casual|private|friends?|mates)\b/i.test(normalized),
    rulesPreference,
    ...(voiceChannelCount === undefined ? {} : { voiceChannelCount }),
  };
}

const namedChannels: Array<{ name: string; phrases: string[] }> = [
  { name: 'general', phrases: ['general', 'general chat', 'general-channel'] },
  { name: 'minecraft-chat', phrases: ['minecraft chat', 'minecraft-chat'] },
  { name: 'build-showcase', phrases: ['build showcase', 'show builds', 'share builds', 'post builds', 'showcase builds', 'minecraft builds', 'builds'] },
  { name: 'voice', phrases: ['voice', 'voice chat', 'voice channel', 'voice channels', 'one voice channel'] },
  { name: 'events', phrases: ['events', 'event', 'game nights', 'game night'] },
  { name: 'tournaments', phrases: ['tournaments', 'tournament'] },
  { name: 'announcements', phrases: ['announcements', 'announcement'] },
  { name: 'rules', phrases: ['rules channel', 'rules'] },
  { name: 'tickets', phrases: ['tickets', 'ticket'] },
  { name: 'support', phrases: ['support channel', 'support'] },
  { name: 'clips', phrases: ['clips', 'clip'] },
  { name: 'looking-for-group', phrases: ['looking for group', 'looking-for-group', 'lfg'] },
  { name: 'staff-applications', phrases: ['staff applications', 'staff application', 'applications'] },
  { name: 'resources', phrases: ['resources', 'resource channel'] },
  { name: 'start-here', phrases: ['start here', 'onboarding'] },
  { name: 'trading', phrases: ['trading channel', 'trading'] },
];

function parseNamedChannels(text: string) {
  return namedChannels.filter((channel) => hasAny(text, channel.phrases)).map((channel) => channel.name);
}

function categoryForChannel(channel: string): SetupCategory {
  if (channel === 'voice') return { name: '🔊 VOICE', channels: [] };
  if (channel === 'minecraft-chat' || channel === 'build-showcase') return { name: '🎮 MINECRAFT', channels: [] };
  if (channel.endsWith('-chat') && knownGames.some((game) => channel === `${game}-chat`)) return { name: '🎮 GAMES', channels: [] };
  const feature = featureCatalog.find((item) => item.category.channels.includes(channel));
  return feature ? { name: feature.category.name, channels: [] } : { name: '💬 COMMUNITY', channels: [] };
}

function addChannel(categories: SetupCategory[], channel: string, categoryName?: string) {
  const targetName = categoryName ?? categoryForChannel(channel).name;
  let category = categories.find((current) => current.name === targetName);
  if (!category) {
    category = { name: targetName, channels: [] };
    categories.push(category);
  }
  if (!category.channels.some((current) => current.toLowerCase() === channel.toLowerCase())) category.channels.push(channel);
}

function templateFallback(type: SetupType): SetupCategory[] {
  const channels = getTemplate(type);
  const picked = channels.flatMap((category) => category.channels.map((channel) => ({ category: category.name, channel })))
    .filter(({ channel }) => ['welcome', 'rules', 'announcements', 'general', 'gaming-chat', 'introductions', 'fan-chat', 'product-discussion'].includes(channel));
  const result: SetupCategory[] = [];
  for (const item of picked) addChannel(result, item.channel, item.category);
  return result;
}

export function createDefaultRules(type: SetupType, description: string, intent = extractSetupIntent(type, description)) {
  if (intent.rulesPreference === 'exclude') return [];
  const normalized = description.toLowerCase();
  const rules = type === 'Esports'
    ? ['Treat players and opponents respectfully.', 'No cheating, exploits, or intentional match disruption.', 'Use team, recruitment, and tournament channels for their intended purpose.', 'Keep chat constructive and free of spam or harassment.']
    : type === 'Creator'
      ? ['Treat creators and community members respectfully.', 'Share videos, feedback, and discussion in the relevant channels.', 'Keep feedback constructive; harassment and personal attacks are not welcome.', 'Avoid spam and repeated unsolicited promotion.']
      : type === 'Business'
        ? ['Communicate respectfully and keep discussion professional.', 'Use the relevant support and resource channels so requests are easy to find.', 'Keep messages on topic and avoid spam or harassment.']
        : type === 'Gaming' && hasAny(normalized, ['minecraft', 'smp'])
        ? ['Respect other players and their builds.', 'No griefing, cheating, or exploiting bugs in the SMP.', intent.requestedFeatures.includes('trading') ? 'Use the trading channel for offers and keep game discussion on topic.' : 'Keep game discussion on topic.', 'Avoid spam, harassment, and disruptive behavior.']
          : ['Treat other members respectfully; harassment and personal attacks are not welcome.', 'Use the relevant channels and keep discussion on topic.', 'Avoid spam, scams, and disruptive behavior.'];
  if (intent.moderationPreference === 'strict') rules.push('Follow moderator directions; raise concerns calmly through the appropriate channel.');
  return rules;
}

function addUnique(categories: SetupCategory[], additions: SetupCategory[]) {
  const existingChannelNames = new Set(categories.flatMap((category) => category.channels));

  for (const addition of additions) {
    const category = categories.find((current) => current.name === addition.name);
    const newChannels = addition.channels.filter((channel) => !existingChannelNames.has(channel));
    if (category) {
      category.channels.push(...newChannels);
    } else if (newChannels.length > 0) {
      categories.push({ name: addition.name, channels: [...newChannels] });
    }
    newChannels.forEach((channel) => existingChannelNames.add(channel));
  }
}

export function applyExplicitSetupIntent(plan: SetupPlan, intent: SetupIntent, fallbackPlan: SetupPlan, preserveCustomizations = false): SetupPlan {
  const result: SetupPlan = {
    ...plan,
    categories: plan.categories.map((category) => ({ ...category, channels: [...category.channels] })),
    voiceCategories: plan.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] })),
    requestedFeatures: [...plan.requestedFeatures],
    recommendedFeatures: [...plan.recommendedFeatures],
    skippedFeatures: [...plan.skippedFeatures],
    roles: [...plan.roles],
    rules: [...plan.rules],
  };
  if (intent.requestedFeatures.includes('tickets') && !intent.separateSupportChannelRequested) {
    result.requestedFeatures = result.requestedFeatures.filter((feature) => feature.toLowerCase() !== 'support');
    result.recommendedFeatures = result.recommendedFeatures.filter((feature) => feature.toLowerCase() !== 'support');
  }
  const vipRequested = fallbackPlan.roles.some((role) => role.kind === 'vip');
  if (!vipRequested) {
    const isTierFeature = (feature: string) => /\b(?:vip|supporter|premium|donor|booster|paid tier|paid member|sponsor)\b/i.test(feature);
    result.requestedFeatures = result.requestedFeatures.filter((feature) => !isTierFeature(feature));
    result.recommendedFeatures = result.recommendedFeatures.filter((feature) => !isTierFeature(feature));
  }

  if (intent.rulesPreference === 'exclude') {
    for (const category of result.categories) category.channels = category.channels.filter((channel) => channel !== 'rules');
  } else if (intent.rulesPreference === 'include') {
    addUnique(result.categories, [{ name: '📢 INFORMATION', channels: ['rules'] }]);
  }

  const excludedChannels = new Set(intent.excludedChannels.map((channel) => channel.toLowerCase()));
  const excludedFeatures = new Set(intent.excludedFeatures);
  if (excludedFeatures.has('tickets') && !intent.requestedFeatures.includes('support')) excludedFeatures.add('support');
  if (intent.requestedFeatures.includes('tickets') && !intent.separateSupportChannelRequested) {
    excludedChannels.add('support');
  }
  if (!intent.playerRecruitmentRequested) {
    for (const channel of ['player-recruitment', 'player-applications', 'team-recruitment', 'tryouts', 'tryout-info']) {
      excludedChannels.add(channel);
    }
  }
  const channelsByFeature: Record<string, string[]> = {
    support: ['support'],
    tickets: ['tickets'],
    events: ['events'],
    tournaments: ['tournaments'],
    media: ['content-discussion', 'feedback', 'video-sharing'],
    clips: ['clips'],
    'build-showcase': ['build-showcase'],
    general: ['general'],
    announcements: ['announcements'],
    rules: ['rules'],
    lfg: ['looking-for-group'],
    teams: ['teams', 'player-recruitment'],
    scrims: ['scrims', 'match-results'],
    vip: ['supporter-chat'],
    faq: ['faqs'],
    giveaways: ['giveaways'],
    trading: ['trading'],
    applications: ['application', 'applications', 'staff-applications'],
    resources: ['resources'],
    onboarding: ['start-here'],
    'staff-area': ['staff-chat', 'staff'],
  };
  for (const featureId of excludedFeatures) {
    for (const channel of channelsByFeature[featureId] ?? []) excludedChannels.add(channel);
  }
  if (excludedFeatures.has('support')) excludedChannels.add('tickets');
  for (const category of result.categories) {
    category.channels = category.channels.filter((channel) => !excludedChannels.has(channel.toLowerCase()));
  }
  if (excludedFeatures.has('voice') || excludedChannels.has('voice')) result.voiceCategories = [];

  if (intent.onlyRequestedFeatures && !preserveCustomizations) {
    result.categories = fallbackPlan.categories.map((category) => ({ ...category, channels: [...category.channels] }));
    result.voiceCategories = fallbackPlan.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] }));
    result.roles = fallbackPlan.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  } else {
    for (const category of fallbackPlan.categories) {
      const existing = result.categories.find((candidate) => candidate.name === category.name);
      if (!existing) result.categories.push({ ...category, channels: [...category.channels] });
      else {
        for (const channel of category.channels) {
          if (!existing.channels.some((existingChannel) => existingChannel.toLowerCase() === channel.toLowerCase())) existing.channels.push(channel);
        }
      }
    }
    for (const game of knownGames) {
      if (intent.gameNames.includes(game)) continue;
      for (const category of result.categories) category.channels = category.channels.filter((channel) => channel.toLowerCase() !== `${game}-chat`);
    }
    const fallbackNames = new Set(fallbackPlan.categories.flatMap((category) => category.channels.map((channel) => channel.toLowerCase())));
    const knownTemplateNames = new Set(getTemplate(plan.type).flatMap((category) => category.channels.map((channel) => channel.toLowerCase())));
    if (!preserveCustomizations) {
      for (const category of result.categories) {
        category.channels = category.channels.filter((channel) => !knownTemplateNames.has(channel.toLowerCase()) || fallbackNames.has(channel.toLowerCase()));
      }
    }
    if ((intent.minimal || intent.scale === 'small') && !preserveCustomizations) {
      const maxTextChannels = intent.approximateSize !== undefined && intent.approximateSize <= 15 ? 6 : 10;
      const explicitChannels = fallbackPlan.categories.flatMap((category) => category.channels);
      const customChannels = result.categories.flatMap((category) => category.channels)
        .filter((channel) => !knownTemplateNames.has(channel.toLowerCase()) && !explicitChannels.some((required) => required.toLowerCase() === channel.toLowerCase()));
      const keep = new Set([...explicitChannels, ...customChannels.slice(0, Math.max(0, maxTextChannels - explicitChannels.length))].map((channel) => channel.toLowerCase()));
      for (const category of result.categories) category.channels = category.channels.filter((channel) => keep.has(channel.toLowerCase()));
      const maxCategories = intent.approximateSize !== undefined && intent.approximateSize <= 15 ? 4 : 5;
      result.categories = result.categories.filter((category) => category.channels.length > 0).slice(0, maxCategories);
      const fallbackRoleNames = new Set(fallbackPlan.roles.map((role) => role.name.toLowerCase()));
      result.roles = result.roles.filter((role) => fallbackRoleNames.has(role.name.toLowerCase()) || role.kind !== 'staff' && role.kind !== 'vip');
    }
    if (intent.scale === 'medium' && !preserveCustomizations) {
      const fallbackNames = new Set(fallbackPlan.categories.flatMap((category) => category.channels.map((channel) => channel.toLowerCase())));
      const optionalTemplateNames = new Set(['tickets', 'support', 'clips', 'media', 'looking-for-group', 'tournaments', 'player-recruitment', 'teams', 'supporter-chat', 'staff', 'staff-chat']);
      for (const category of result.categories) category.channels = category.channels.filter((channel) => !optionalTemplateNames.has(channel.toLowerCase()) || fallbackNames.has(channel.toLowerCase()));
    }
  }

  if (excludedFeatures.has('events') && !intent.requestedFeatures.includes('tournaments')) {
    for (const category of result.categories) category.channels = category.channels.filter((channel) => channel.toLowerCase() !== 'events');
  }
  if (excludedFeatures.has('tournaments') || intent.requestedFeatures.includes('events') && !intent.requestedFeatures.includes('tournaments')) {
    for (const category of result.categories) category.channels = category.channels.filter((channel) => channel.toLowerCase() !== 'tournaments');
  }

  const requestedVoice = intent.requestedFeatures.includes('voice') && !excludedFeatures.has('voice');
  if (requestedVoice) {
    result.voiceCategories = fallbackPlan.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] }));
  } else if (intent.onlyRequestedFeatures || intent.minimal || intent.scale === 'small' || intent.scale === 'medium') {
    result.voiceCategories = [];
  }

  if (intent.onlyRequestedFeatures) {
    if (!preserveCustomizations) {
      result.categories = fallbackPlan.categories.map((category) => ({ ...category, channels: [...category.channels] }));
      result.voiceCategories = fallbackPlan.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] }));
    }
  }

  for (const role of fallbackPlan.roles.filter((plannedRole) => plannedRole.explicitlyRequested)) {
    if (!result.roles.some((currentRole) => currentRole.name.toLowerCase() === role.name.toLowerCase())) result.roles.push(role);
  }
  const fallbackRoleNames = new Set(fallbackPlan.roles.map((role) => role.name.toLowerCase()));
  result.roles = result.roles.filter((role) =>
    (role.kind !== 'staff' && role.kind !== 'vip' || fallbackRoleNames.has(role.name.toLowerCase()))
      && (vipRequested || !/\b(?:vip|supporter|premium|donor|booster|paid tier|paid member|sponsor)\b/i.test(role.name)));
  if (intent.onlyRequestedFeatures && !preserveCustomizations) {
    result.roles = fallbackPlan.roles.map((role) => ({ ...role, permissions: [...role.permissions] }));
  }
  if (excludedFeatures.has('staff-roles')) {
    result.roles = result.roles.filter((role) => role.kind !== 'staff' && role.kind !== 'vip');
  }
  if (intent.rulesPreference === 'exclude') {
    result.rules = [];
    for (const category of result.categories) category.channels = category.channels.filter((channel) => channel !== 'rules');
  } else if (!result.categories.some((category) => category.channels.includes('rules'))) {
    result.rules = [];
  } else if ((intent.minimal || intent.scale === 'small') && fallbackPlan.rules.length > 0) {
    result.rules = [...fallbackPlan.rules];
  } else if (result.rules.length === 0) {
    result.rules = fallbackPlan.rules.length ? [...fallbackPlan.rules] : createDefaultRules(plan.type, plan.description, intent);
  }
  for (const featureId of excludedFeatures) {
    const feature = featureCatalog.find((item) => item.id === featureId);
    if (!feature) continue;
    result.requestedFeatures = result.requestedFeatures.filter((label) => label !== feature.label);
    result.recommendedFeatures = result.recommendedFeatures.filter((label) => label !== feature.label);
    if (!result.skippedFeatures.includes(feature.label)) result.skippedFeatures.push(feature.label);
  }
  for (const category of result.categories) category.channels = [...new Map(category.channels.map((channel) => [channel.toLowerCase(), channel])).values()];
  const allChannels = new Set<string>();
  for (const category of result.categories) {
    category.channels = category.channels.filter((channel) => {
      const key = channel.toLowerCase();
      if (allChannels.has(key)) return false;
      allChannels.add(key);
      return true;
    });
  }
  for (let index = result.categories.length - 1; index >= 0; index -= 1) {
    if (!result.categories[index]?.channels.length) result.categories.splice(index, 1);
  }
  return result;
}

function createFeatureCategories(feature: Feature) {
  return [{ ...feature.category, channels: [...feature.category.channels] }];
}

export function applySetupAnswer(plan: SetupPlan, type: SetupType, description: string, answers: SetupAnswers, questionId: string): SetupPlan {
  const answer = answers[questionId];
  if (!answer) return plan;
  const intent = extractSetupIntent(type, description);
  const result: SetupPlan = {
    ...plan,
    categories: plan.categories.map((category) => ({ ...category, channels: [...category.channels] })),
    voiceCategories: plan.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] })),
    requestedFeatures: [...plan.requestedFeatures],
    recommendedFeatures: [...plan.recommendedFeatures],
    skippedFeatures: [...plan.skippedFeatures],
    roles: [...plan.roles],
    rules: [...plan.rules],
  };
  const feature = featureCatalog.find((item) => item.id === questionId);
  const nextFallback = createSetupPlan(type, description, answers);

  if (feature) {
    const include = answer === 'yes' || (answer === 'decide' && decideRecommendations[type].includes(feature.id));
    if (feature.id === 'voice') {
      result.voiceCategories = include ? nextFallback.voiceCategories.map((category) => ({ ...category, channels: [...category.channels] })) : [];
    } else {
      const namesByFeature: Record<string, string[]> = {
        media: ['media', 'clips', 'content-discussion', 'feedback', 'video-sharing'],
        events: ['events', 'tournaments'],
        teams: ['teams'],
        scrims: ['scrims', 'match-results'],
        support: ['support'],
        tickets: ['tickets'],
        applications: ['application', 'applications', 'staff-applications'],
        resources: ['resources'],
        onboarding: ['start-here'],
        'staff-area': ['staff', 'staff-chat'],
      };
      const channelNames = new Set((namesByFeature[feature.id] ?? feature.category.channels).map((name) => name.toLowerCase()));
      if (!include) {
        for (const category of result.categories) category.channels = category.channels.filter((channel) => !channelNames.has(channel.toLowerCase()));
      } else {
        const additions = feature.id === 'events'
          ? nextFallback.categories.map((category) => ({ ...category, channels: category.channels.filter((channel) => channelNames.has(channel.toLowerCase())) })).filter((category) => category.channels.length > 0)
          : createFeatureCategories(feature);
        if (feature.id === 'teams' && intent.playerRecruitmentRequested) {
          additions.push({ name: '🏆 COMPETITION', channels: ['player-recruitment'] });
        }
        addUnique(result.categories, additions);
      }
    }
    result.requestedFeatures = result.requestedFeatures.filter((label) => label !== feature.label);
    result.recommendedFeatures = result.recommendedFeatures.filter((label) => label !== feature.label);
    result.skippedFeatures = result.skippedFeatures.filter((label) => label !== feature.label);
    if (answer === 'yes' && !result.requestedFeatures.includes(feature.label)) result.requestedFeatures.push(feature.label);
    else if (include && answer === 'decide') result.recommendedFeatures.push(feature.label);
    else if (!include) result.skippedFeatures.push(feature.label);
  } else {
    const roleNamesByQuestion: Record<string, string> = {
      'roles-moderators': '🔨 Moderator',
      'roles-vip': '⭐ VIP',
      'roles-tournament-staff': '🏆 Tournament Staff',
      'roles-team-captains': '👥 Team Captain',
      'roles-support': '🛠️ Support Staff',
    };
    const roleName = roleNamesByQuestion[questionId];
    if (!roleName) return result;
    result.roles = result.roles.filter((role) => role.name.toLowerCase() !== roleName.toLowerCase());
    const plannedRole = nextFallback.roles.find((role) => role.name.toLowerCase() === roleName.toLowerCase());
    if (plannedRole) result.roles.push(plannedRole);
  }

  for (let index = result.categories.length - 1; index >= 0; index -= 1) {
    if (!result.categories[index]?.channels.length) result.categories.splice(index, 1);
  }
  return result;
}

function questionsFor(type: SetupType, description: string): SetupQuestion[] {
  const normalized = description.toLowerCase();
  if (extractSetupIntent(type, description).minimal) return [];
  return questionCatalog[type].filter((question) => {
    const feature = featureCatalog.find((item) => item.id === question.feature);
    return Boolean(feature && !hasAny(normalized, feature.keywords) && !explicitlyExcluded(normalized, feature.keywords));
  });
}

export function getSetupQuestions(type: SetupType, description: string) {
  return questionsFor(type, description);
}

export function createSetupPlan(type: SetupType, description: string, answers: SetupAnswers = {}): SetupPlan {
  const normalized = description.toLowerCase();
  const intent = extractSetupIntent(type, description);
  const vague = !intent.minimal && !intent.onlyRequestedFeatures && intent.scale === 'unspecified'
    && description.trim().split(/\s+/).length <= 6
    && intent.requestedFeatures.length === 0
    && intent.gameNames.length === 0
    && intent.requestedChannels.length === 0;
  const categories = intent.onlyRequestedFeatures ? [] : vague ? templateFallback(type) : [];
  if (!intent.onlyRequestedFeatures && !vague && (intent.requestedFeatures.length > 0 || intent.gameNames.length > 0 || intent.scale !== 'unspecified')) {
    addChannel(categories, 'general', '💬 COMMUNITY');
  }

  const voiceCategories: SetupCategory[] = [];
  const requestedFeatures: string[] = [];
  const recommendedFeatures: string[] = [];
  const skippedFeatures: string[] = [];

  for (const channel of intent.requestedChannels) {
    if (channel !== 'voice' && !(channel === 'support' && intent.requestedFeatures.includes('tickets') && !intent.separateSupportChannelRequested)) {
      addChannel(categories, channel);
    }
  }
  for (const game of intent.gameNames) {
    if (!intent.onlyRequestedFeatures) addChannel(categories, `${game}-chat`, game === 'minecraft' ? '🎮 MINECRAFT' : '🎮 GAMES');
  }

  for (const feature of featureCatalog) {
    const explicitYes = hasAny(normalized, feature.keywords) && !explicitlyExcluded(normalized, feature.keywords);
    const explicitNo = explicitlyExcluded(normalized, feature.keywords);
    const answer = answers[feature.id];
    if (feature.id === 'support' && intent.requestedFeatures.includes('tickets') && !intent.separateSupportChannelRequested) continue;
    const largeDefault = intent.scale === 'large' || intent.scale === 'very-large';
    const recommended = answer === 'yes'
      || (!explicitNo && answer === 'decide' && decideRecommendations[type].includes(feature.id))
      || (!intent.onlyRequestedFeatures && !intent.minimal && intent.scale === 'unspecified' && vague && decideRecommendations[type].includes(feature.id))
      || (!intent.onlyRequestedFeatures && largeDefault && feature.id === 'announcements' && type !== 'Custom');

    if (explicitNo || answer === 'no') {
      skippedFeatures.push(feature.label);
      continue;
    }
    if (intent.onlyRequestedFeatures && !intent.requestedFeatures.includes(feature.id) && answer !== 'yes') continue;
    if (explicitYes || answer === 'yes') {
      requestedFeatures.push(feature.label);
    } else if (recommended) {
      recommendedFeatures.push(feature.label);
    } else {
      continue;
    }

    if (feature.id === 'voice') {
      const voiceCount = intent.voiceChannelCount ?? (intent.onlyRequestedFeatures ? 1 : 1);
      const voiceNames = ['General', 'Gaming', 'Events'];
      voiceCategories.push({ name: '🔊 VOICE', channels: Array.from({ length: voiceCount }, (_, index) => voiceNames[index] ?? `Voice ${index + 1}`) });
    } else {
      if (feature.id === 'general') {
        addChannel(categories, 'general', '💬 COMMUNITY');
      } else if (feature.id === 'announcements' || feature.id === 'rules') {
        addChannel(categories, feature.id, '📢 INFORMATION');
      } else {
        for (const channel of feature.category.channels) addChannel(categories, channel, feature.id === 'events' ? '📅 EVENTS' : undefined);
        if (feature.id === 'teams' && intent.playerRecruitmentRequested) addChannel(categories, 'player-recruitment', '🏆 COMPETITION');
      }
    }
  }

  if (intent.rulesPreference === 'include') addChannel(categories, 'rules', '📢 INFORMATION');
  if (intent.rulesPreference === 'exclude') for (const category of categories) category.channels = category.channels.filter((channel) => channel !== 'rules');
  for (const channel of intent.excludedChannels) {
    for (const category of categories) category.channels = category.channels.filter((current) => current.toLowerCase() !== channel.toLowerCase());
    if (channel === 'voice') voiceCategories.length = 0;
  }
  if (intent.excludedFeatures.includes('tickets') && !intent.requestedFeatures.includes('support')) {
    for (const category of categories) category.channels = category.channels.filter((channel) => !['tickets', 'support'].includes(channel.toLowerCase()));
  }
  if (intent.excludedFeatures.includes('applications')) {
    for (const category of categories) category.channels = category.channels.filter((channel) => !['application', 'applications', 'staff-applications'].includes(channel.toLowerCase()));
  }
  if (intent.excludedFeatures.includes('announcements')) {
    for (const category of categories) category.channels = category.channels.filter((channel) => channel !== 'announcements');
  }
  if (intent.onlyRequestedFeatures) {
    const allowlist = new Set(intent.requestedChannels.filter((channel) => channel !== 'voice').map((channel) => channel.toLowerCase()));
    for (const category of categories) category.channels = category.channels.filter((channel) => allowlist.has(channel.toLowerCase()));
  }
  for (let index = categories.length - 1; index >= 0; index -= 1) {
    if (!categories[index]?.channels.length) categories.splice(index, 1);
  }

  const roles = createRolePlan(type, description, answers);
  if (intent.minimal || intent.onlyRequestedFeatures || intent.scale === 'small') {
    const explicitRoleRequest = /\b(?:moderators?|mod team|staff team|support staff|event staff|tournament staff|team captains?)\b/i.test(normalized);
    if (!explicitRoleRequest) {
      for (let index = roles.length - 1; index >= 0; index -= 1) {
        if (roles[index]?.kind === 'staff' || roles[index]?.kind === 'vip') roles.splice(index, 1);
      }
    }
  }

  return {
    type,
    description,
    categories,
    voiceCategories,
    recommendedFeatures,
    requestedFeatures,
    skippedFeatures,
    roles,
    rules: categories.some((category) => category.channels.includes('rules')) ? createDefaultRules(type, description, intent) : [],
  };
}