import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { AutomationProposalError, generateAiAutomationProposal } from '../ai/automation.js';
import { automationService } from '../automation/service.js';
import type { Automation, AutomationAction, AutomationCondition, AutomationProposal, AutomationTriggerType } from '../automation/types.js';

const drafts = new Map<string, Automation>();
const pendingProposals = new Map<string, { proposal: AutomationProposal; guildId: string; userId: string; expiresAt: number }>();
const proposalTtlMs = 15 * 60 * 1000;
const triggerChoices: Array<[AutomationTriggerType, string]> = [
  ['MEMBER_JOIN', 'Member joins'], ['MEMBER_LEAVE', 'Member leaves'], ['MESSAGE_CREATE', 'Message created'],
  ['WARNING_ISSUED', 'Warning issued'], ['TICKET_OPENED', 'Ticket opened'], ['TICKET_CLOSED', 'Ticket closed'],
];
const actionTypes: AutomationAction['type'][] = ['ADD_ROLE', 'REMOVE_ROLE', 'SEND_MESSAGE', 'SEND_DM', 'ADD_WARNING', 'TIMEOUT_MEMBER', 'NOTIFY_ROLE'];
const conditionTypes = ['HAS_ROLE', 'DOES_NOT_HAVE_ROLE', 'WARNING_COUNT', 'CHANNEL_IS'] as const;
const draftKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

export const automationCommand = {
  data: new SlashCommandBuilder()
    .setName('automation').setDescription('Manage WHEN → IF → THEN automations.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('create').setDescription('Create an automation workflow.')
      .addStringOption((option) => option.setName('name').setDescription('Automation name.').setRequired(true))
      .addStringOption((option) => option.setName('trigger').setDescription('When it runs.').setRequired(true).addChoices(...triggerChoices.map(([value, name]) => ({ name, value })))))
    .addSubcommand((subcommand) => subcommand
      .setName('ai').setDescription('Draft an automation with AI for your review.')
      .addStringOption((option) => option.setName('description').setDescription('Describe the automation you want.').setMaxLength(500).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('edit').setDescription('Edit an automation workflow.').addStringOption((option) => option.setName('id').setDescription('Automation ID.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List this server\'s automations.'))
    .addSubcommand((subcommand) => subcommand.setName('view').setDescription('View an automation.').addStringOption((option) => option.setName('id').setDescription('Automation ID.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('delete').setDescription('Delete an automation.').addStringOption((option) => option.setName('id').setDescription('Automation ID.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('enable').setDescription('Enable an automation.').addStringOption((option) => option.setName('id').setDescription('Automation ID.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('disable').setDescription('Disable an automation.').addStringOption((option) => option.setName('id').setDescription('Automation ID.').setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) return interaction.reply({ content: 'Automation commands can only be used inside a Discord server.', ephemeral: true });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server permission to manage automations.', ephemeral: true });
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'create') {
      const draft: Automation = { id: `auto_${Date.now().toString(36)}`, guildId: interaction.guild.id, name: interaction.options.getString('name', true).trim().slice(0, 100) || 'Untitled automation', enabled: true, trigger: { type: interaction.options.getString('trigger', true) as AutomationTriggerType }, conditions: [], actions: [], createdAt: Date.now() };
      drafts.set(draftKey(interaction.guild.id, interaction.user.id), draft);
      return showBuilder(interaction, draft, 'Add at least one action, then preview and confirm.');
    }
    if (subcommand === 'ai') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const proposal = await generateAiAutomationProposal(interaction.guild, interaction.options.getString('description', true));
        const id = `auto_${randomUUID()}`;
        pendingProposals.set(id, {
          proposal,
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          expiresAt: Date.now() + proposalTtlMs,
        });
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`serverpilot:automation:proposal-confirm:${id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`serverpilot:automation:proposal-cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
        );
        return interaction.editReply({ embeds: [proposalEmbed(proposal)], components: [row] });
      } catch (error) {
        if (error instanceof AutomationProposalError) {
          return interaction.editReply({ content: error.message });
        }
        console.error('Unexpected error while generating AI automation:', redactAiAutomationError(error));
        try {
          return await interaction.editReply({
            content: 'ServerPilot encountered an unexpected error while generating the AI automation. Please try again.',
          });
        } catch (replyError) {
          console.error('Failed to send AI automation error reply:', redactAiAutomationError(replyError));
          return;
        }
      }
    }
    if (subcommand === 'edit') {
      const existing = await automationService.get(interaction.options.getString('id', true), interaction.guild.id);
      if (!existing) return interaction.reply({ content: 'Automation not found in this server.', ephemeral: true });
      const draft = structuredClone(existing) as Automation;
      drafts.set(draftKey(interaction.guild.id, interaction.user.id), draft);
      return showBuilder(interaction, draft, 'Changes stay in this draft until you confirm.');
    }
    if (subcommand === 'list') return listAutomations(interaction);
    const automation = await automationService.get(interaction.options.getString('id', true), interaction.guild.id);
    if (!automation) return interaction.reply({ content: 'Automation not found in this server.', ephemeral: true });
    if (subcommand === 'view') return interaction.reply({ embeds: [automationEmbed(automation)], ephemeral: true });
    if (subcommand === 'delete') return requestDelete(interaction, automation);
    const updated = await automationService.setEnabled(automation.id, interaction.guild.id, subcommand === 'enable');
    if (!updated) return interaction.reply({ content: 'Automation not found in this server.', ephemeral: true });
    return interaction.reply({ content: `Automation **${updated.name}** is now ${updated.enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
  },
};

function redactAiAutomationError(error: unknown): { name?: string; message: string; stack?: string } {
  const details = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };
  const secretValues = Object.entries(process.env)
    .filter((entry): entry is [string, string] => Boolean(entry[1]) && /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(entry[0]))
    .map(([, value]) => value);
  const redact = (value: string) => {
    let sanitized = value;
    for (const secret of secretValues) sanitized = sanitized.replaceAll(secret, '[REDACTED]');
    return sanitized.replace(
      /\b((?:api[_ -]?key|access[_ -]?token|authorization|password|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    );
  };

  return {
    ...(details.name ? { name: redact(details.name) } : {}),
    message: redact(details.message),
    ...(details.stack ? { stack: redact(details.stack) } : {}),
  };
}

function showBuilder(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction, draft: Automation, notice: string) {
  const rows = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`serverpilot:automation:add-condition:${draft.id}`).setLabel('Add Condition').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`serverpilot:automation:add-action:${draft.id}`).setLabel('Add Action').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`serverpilot:automation:preview:${draft.id}`).setLabel('Preview').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`serverpilot:automation:confirm:${draft.id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`serverpilot:automation:remove-condition:${draft.id}`).setLabel('Remove Last Condition').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`serverpilot:automation:remove-action:${draft.id}`).setLabel('Remove Last Action').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`serverpilot:automation:cancel:${draft.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
  const response = { content: notice, embeds: [automationEmbed(draft, true)], components: rows, ephemeral: true };
  if (interaction.isChatInputCommand() || interaction.isModalSubmit()) return interaction.reply(response);
  return interaction.update(response);
}

function modal(id: string, title: string, fields: Array<[string, string, string]>) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map(([customId, label, placeholder]) => new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100))));
}

async function addCondition(interaction: ButtonInteraction, draft: Automation) {
  await interaction.showModal(modal(`serverpilot:automation:condition-modal:${draft.id}`, 'Add Condition', [
    ['type', 'Type', conditionTypes.join(', ')], ['target', 'Role or channel ID', 'Paste a Discord ID'], ['value', 'Value', 'Warning threshold number'],
  ]));
}

async function addAction(interaction: ButtonInteraction, draft: Automation) {
  await interaction.showModal(modal(`serverpilot:automation:action-modal:${draft.id}`, 'Add Action', [
    ['type', 'Type', actionTypes.join(', ')], ['target', 'Role or channel ID', 'Paste a Discord ID'], ['message', 'Message or reason', 'Use {user}, {server}, {username}'], ['duration', 'Timeout minutes', 'Optional, defaults to 10'],
  ]));
}

async function handleModal(interaction: ModalSubmitInteraction, draft: Automation) {
  const kind = interaction.customId.includes('condition-modal') ? 'condition' : 'action';
  const type = interaction.fields.getTextInputValue('type').trim().toUpperCase();
  const target = interaction.fields.getTextInputValue('target').trim();
  const value = interaction.fields.getTextInputValue('value').trim();
  const message = interaction.fields.getTextInputValue('message').trim();
  if (kind === 'condition') {
    if ((type === 'HAS_ROLE' || type === 'DOES_NOT_HAVE_ROLE') && !(await interaction.guild?.roles.fetch(target).catch(() => undefined))) return interaction.reply({ content: 'That role could not be found in this server.', ephemeral: true });
    if (type === 'CHANNEL_IS' && !(await interaction.guild?.channels.fetch(target).catch(() => undefined))) return interaction.reply({ content: 'That channel could not be found in this server.', ephemeral: true });
    if (type === 'HAS_ROLE' || type === 'DOES_NOT_HAVE_ROLE') draft.conditions.push({ type, roleId: target });
    else if (type === 'CHANNEL_IS') draft.conditions.push({ type, channelId: target });
    else if (type === 'WARNING_COUNT' && Number.isInteger(Number(value)) && Number(value) >= 0) draft.conditions.push({ type, operator: 'GREATER_THAN_OR_EQUAL', value: Number(value) });
    else return interaction.reply({ content: 'Invalid condition. Use a supported type and valid ID/threshold.', ephemeral: true });
  } else {
    const duration = Number(interaction.fields.getTextInputValue('duration').trim() || '10');
    if ((type === 'ADD_ROLE' || type === 'REMOVE_ROLE') && !(await interaction.guild?.roles.fetch(target).catch(() => undefined))) return interaction.reply({ content: 'That role could not be found in this server.', ephemeral: true });
    if (type === 'NOTIFY_ROLE' && (target === interaction.guild?.id || !(await interaction.guild?.roles.fetch(target).catch(() => undefined)))) return interaction.reply({ content: 'Choose a valid role other than @everyone to notify.', ephemeral: true });
    if ((type === 'SEND_MESSAGE' || type === 'NOTIFY_ROLE') && !(await interaction.guild?.channels.fetch(type === 'NOTIFY_ROLE' ? value : target).catch(() => undefined))) return interaction.reply({ content: 'That channel could not be found in this server.', ephemeral: true });
    if (type === 'ADD_ROLE' || type === 'REMOVE_ROLE') draft.actions.push({ type, roleId: target });
    else if (type === 'SEND_MESSAGE') draft.actions.push({ type, channelId: target, message });
    else if (type === 'SEND_DM') draft.actions.push({ type, message });
    else if (type === 'ADD_WARNING') draft.actions.push({ type, reason: message || 'Automation warning' });
    else if (type === 'TIMEOUT_MEMBER' && Number.isInteger(duration) && duration > 0) draft.actions.push({ type, durationMinutes: Math.min(duration, 28 * 24 * 60), reason: message || 'Automation timeout' });
    else if (type === 'NOTIFY_ROLE') draft.actions.push({ type, roleId: target, channelId: value, message });
    else return interaction.reply({ content: 'Invalid action. Use a supported type and required values.', ephemeral: true });
  }
  return showBuilder(interaction, draft, `${kind === 'condition' ? 'Condition' : 'Action'} added. Add more or preview the workflow.`);
}

function proposalEmbed(proposal: AutomationProposal) {
  const conditions = proposal.conditions.length ? proposal.conditions.map((condition) => `• ${formatCondition(condition)}`).join('\n') : '• None';
  const actions = proposal.actions.map((action, index) => `${index + 1}. ${formatAction(action)}`).join('\n');
  const warnings = proposal.riskWarnings.length ? proposal.riskWarnings.map((warning) => `• ${warning}`).join('\n') : '• None';
  const description = `**Summary**\n${proposal.summary}\n\n**WHEN**\n${proposal.trigger.type.replaceAll('_', ' ')}\n\n**IF**\n${conditions}\n\n**THEN**\n${actions}\n\n**Risk warnings**\n${warnings}`;
  return new EmbedBuilder().setColor(0x5865f2).setTitle(`AI Proposal: ${proposal.name}`).setDescription(description.slice(0, 4000));
}

function automationEmbed(automation: Automation, preview = false) {
  const conditions = automation.conditions.length ? automation.conditions.map((condition) => `• ${formatCondition(condition)}`).join('\n') : '• None';
  const actions = automation.actions.length ? automation.actions.map((action, index) => `${index + 1}. ${formatAction(action)}`).join('\n') : '• None yet';
  return new EmbedBuilder().setColor(automation.enabled ? 0x57f287 : 0xed4245).setTitle(preview ? '⚙️ Automation Preview' : `⚙️ ${automation.name}`)
    .setDescription(`**Name:** ${automation.name}\n**ID:** ${automation.id}\n\n**WHEN**\n${automation.trigger.type.replaceAll('_', ' ')}\n\n**IF**\n${conditions}\n\n**THEN**\n${actions}\n\n**Status:** ${automation.enabled ? '🟢 Enabled' : '🔴 Disabled'}`)
    .setTimestamp(automation.createdAt);
}

function formatCondition(condition: AutomationCondition) {
  if (condition.type === 'WARNING_COUNT') return `Warning count ${condition.operator.replaceAll('_', ' ').toLowerCase()} ${condition.value}`;
  if (condition.type === 'HAS_ROLE') return `Has role ${condition.roleId}`;
  if (condition.type === 'DOES_NOT_HAVE_ROLE') return `Does not have role ${condition.roleId}`;
  if (condition.type === 'CHANNEL_IS') return `Channel is ${condition.channelId}`;
  return 'Unknown condition';
}

function formatAction(action: AutomationAction) {
  if (action.type === 'ADD_ROLE') return `Add role ${action.roleId}`;
  if (action.type === 'REMOVE_ROLE') return `Remove role ${action.roleId}`;
  if (action.type === 'SEND_MESSAGE' || action.type === 'NOTIFY_ROLE') return `${action.type === 'NOTIFY_ROLE' ? `Notify role ${action.roleId}` : `Send message to ${action.channelId}`}: ${action.message}`;
  if (action.type === 'SEND_DM') return `Send DM: ${action.message}`;
  if (action.type === 'TIMEOUT_MEMBER') return `Timeout member for ${action.durationMinutes} minutes`;
  if (action.type === 'ADD_WARNING') return `Add warning: ${action.reason}`;
  return `Notify role ${action.roleId}`;
}

async function listAutomations(interaction: ChatInputCommandInteraction) {
  const automations = await automationService.listForGuild(interaction.guild!.id);
  if (!automations.length) return interaction.reply({ content: 'No automations configured. Use `/automation create` to create one.', ephemeral: true });
  const description = automations.map((automation, index) => `${index + 1}. **${automation.name}**\nWHEN → ${automation.trigger.type.replaceAll('_', ' ')}\nIF → ${automation.conditions.length} condition(s)\nTHEN → ${automation.actions.length} action(s)\nStatus → ${automation.enabled ? '🟢 Enabled' : '🔴 Disabled'}`).join('\n\n');
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('⚙️ Server Automations').setDescription(description)], ephemeral: true });
}

function requestDelete(interaction: ChatInputCommandInteraction, automation: Automation) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`serverpilot:automation:delete-confirm:${automation.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`serverpilot:automation:cancel:${automation.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  return interaction.reply({ content: `Delete automation **${automation.name}**?`, components: [row], ephemeral: true });
}

export async function handleAutomationInteraction(interaction: ButtonInteraction | ModalSubmitInteraction) {
  if (!interaction.customId.startsWith('serverpilot:automation:')) return false;
  if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: 'You need Manage Server permission for automation controls.', ephemeral: true }); return true; }
  const parts = interaction.customId.split(':'); const action = parts[2]; const id = parts[3];
  const draft = drafts.get(draftKey(interaction.guild.id, interaction.user.id));
  if (interaction.isModalSubmit()) {
    if (!draft || draft.id !== id) { await interaction.reply({ content: 'This automation draft has expired.', ephemeral: true }); return true; }
    await handleModal(interaction, draft); return true;
  }
  if (action === 'proposal-confirm' || action === 'proposal-cancel') {
    const pending = pendingProposals.get(id ?? '');
    if (!pending || pending.guildId !== interaction.guild.id || pending.userId !== interaction.user.id) {
      await interaction.update({ content: 'This AI proposal is no longer available.', embeds: [], components: [] });
    } else if (pending.expiresAt <= Date.now()) {
      pendingProposals.delete(id!);
      await interaction.update({ content: 'This AI proposal has expired. Run `/automation ai` to create another.', embeds: [], components: [] });
    } else if (action === 'proposal-cancel') {
      pendingProposals.delete(id!);
      await interaction.update({ content: 'AI automation proposal cancelled.', embeds: [], components: [] });
    } else {
      const { proposal } = pending;
      await automationService.create({
        id: id!,
        guildId: proposal.guildId,
        name: proposal.name,
        enabled: true,
        trigger: proposal.trigger,
        conditions: proposal.conditions,
        actions: proposal.actions,
        createdAt: Date.now(),
      });
      pendingProposals.delete(id!);
      await interaction.update({ content: `Automation **${proposal.name}** saved. ID: \`${id}\``, embeds: [], components: [] });
    }
  } else if (action === 'add-condition' && draft) await addCondition(interaction, draft);
  else if (action === 'add-action' && draft) await addAction(interaction, draft);
  else if (action === 'remove-condition' && draft) { draft.conditions.pop(); await showBuilder(interaction, draft, 'Last condition removed.'); }
  else if (action === 'remove-action' && draft) { draft.actions.pop(); await showBuilder(interaction, draft, 'Last action removed.'); }
  else if (action === 'preview' && draft) await showBuilder(interaction, draft, 'Review the complete workflow before confirming.');
  else if (action === 'cancel') { drafts.delete(draftKey(interaction.guild.id, interaction.user.id)); await interaction.update({ content: 'Automation editing cancelled.', embeds: [], components: [] }); }
  else if (action === 'confirm' && draft && draft.id === id) {
    if (!draft.actions.length) { await interaction.reply({ content: 'Add at least one action before confirming.', ephemeral: true }); return true; }
    await automationService.create(draft); drafts.delete(draftKey(interaction.guild.id, interaction.user.id)); await interaction.update({ content: `Automation **${draft.name}** saved.`, embeds: [], components: [] });
  } else if (action === 'delete-confirm') {
    const automation = await automationService.get(id ?? '', interaction.guild.id);
    if (!automation) await interaction.update({ content: 'Automation not found.', components: [] });
    else {
      await automationService.delete(automation.id, interaction.guild.id);
      await interaction.update({ content: `Automation **${automation.name}** deleted.`, components: [] });
    }
  } else if (action === 'cancel') await interaction.update({ content: 'Automation action cancelled.', embeds: [], components: [] });
  else await interaction.reply({ content: 'This automation draft is no longer available.', ephemeral: true });
  return true;
}
