import type { SetupCategory, SetupType } from './types.js';

const templates: Record<SetupType, SetupCategory[]> = {
  Gaming: [
    { name: '📢 INFORMATION', channels: ['welcome', 'rules', 'announcements'] },
    { name: '💬 COMMUNITY', channels: ['general', 'media', 'suggestions'] },
    { name: '🎮 GAMING', channels: ['gaming-chat', 'looking-for-group', 'clips'] },
    { name: '🏆 EVENTS', channels: ['tournaments'] },
    { name: '🛠️ SUPPORT', channels: ['tickets'] },
  ],
  Esports: [
    { name: '📢 INFORMATION', channels: ['welcome', 'rules', 'announcements'] },
    { name: '🏆 COMPETITION', channels: ['teams', 'match-results', 'scrims', 'player-recruitment'] },
    { name: '💬 COMMUNITY', channels: ['general', 'media', 'suggestions'] },
    { name: '🛠️ SUPPORT', channels: ['tickets'] },
  ],
  Creator: [
    { name: '📢 INFORMATION', channels: ['welcome', 'announcements'] },
    { name: '🎬 CONTENT', channels: ['content-discussion', 'clips', 'suggestions'] },
    { name: '💬 COMMUNITY', channels: ['fan-chat', 'media'] },
    { name: '⭐ SUPPORTERS', channels: ['supporter-chat'] },
  ],
  Community: [
    { name: '📢 INFORMATION', channels: ['welcome', 'rules', 'announcements'] },
    { name: '💬 COMMUNITY', channels: ['introductions', 'general', 'media', 'suggestions'] },
    { name: '📅 EVENTS', channels: ['events'] },
    { name: '🛠️ SUPPORT', channels: ['support'] },
  ],
  Business: [
    { name: '📢 INFORMATION', channels: ['welcome', 'announcements', 'faqs'] },
    { name: '💼 BUSINESS', channels: ['product-discussion', 'customer-support'] },
    { name: '🛠️ STAFF', channels: ['staff'] },
  ],
  Custom: [
    { name: '📢 INFORMATION', channels: ['welcome', 'rules', 'announcements'] },
    { name: '💬 COMMUNITY', channels: ['general', 'suggestions'] },
    { name: '🛠️ SUPPORT', channels: ['support'] },
  ],
};

export function getTemplate(type: SetupType): SetupCategory[] {
  return templates[type].map((category) => ({
    name: category.name,
    channels: [...category.channels],
  }));
}