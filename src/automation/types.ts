import type { Client, GuildMember, Message } from 'discord.js';

export type AutomationTriggerType =
  | 'MEMBER_JOIN'
  | 'MEMBER_LEAVE'
  | 'MESSAGE_CREATE'
  | 'WARNING_ISSUED'
  | 'TICKET_OPENED'
  | 'TICKET_CLOSED';

export type AutomationCondition =
  | { type: 'HAS_ROLE' | 'DOES_NOT_HAVE_ROLE'; roleId: string }
  | { type: 'WARNING_COUNT'; operator: 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL'; value: number }
  | { type: 'CHANNEL_IS'; channelId: string };

export type AutomationAction =
  | { type: 'ADD_ROLE' | 'REMOVE_ROLE'; roleId: string }
  | { type: 'SEND_MESSAGE'; channelId: string; message: string }
  | { type: 'SEND_DM'; message: string }
  | { type: 'ADD_WARNING'; reason: string }
  | { type: 'TIMEOUT_MEMBER'; durationMinutes: number; reason: string }
  | { type: 'NOTIFY_ROLE'; roleId: string; channelId: string; message: string };

export type Automation = {
  id: string;
  guildId: string;
  name: string;
  enabled: boolean;
  trigger: { type: AutomationTriggerType };
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: number;
};

export type AutomationProposal = {
  proposalId: string;
  guildId: string;
  name: string;
  description?: string;
  trigger: { type: AutomationTriggerType };
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  summary: string;
  riskWarnings: string[];
  requiresConfirmation: true;
};

export type AutomationEvent = {
  guildId: string;
  type: AutomationTriggerType;
  client: Client;
  userId?: string;
  member?: GuildMember;
  channelId?: string;
  message?: Message;
  warningCount?: number;
  ticketId?: string;
  metadata?: Record<string, string>;
  automationDepth?: number;
};
