import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createSetupStructure } from '../setup/creator.js';
import { applyExplicitSetupIntent, applySetupAnswer, createDefaultRules, createSetupPlan, extractSetupIntent, getSetupQuestions } from '../setup/planner.js';
import { generateSetupPlan } from '../ai/planner.js';
import { getRoleQuestions } from '../setup/role-planner.js';
import { getMissingBotPermissions } from '../setup/permissions.js';
import { setupTypes } from '../setup/types.js';
import type { SetupAnswers, SetupCategory, SetupQuestion, SetupRequest, SetupRole, SetupType } from '../setup/types.js';

const setupSelectId = 'serverpilot:setup:type';
const setupPrefix = 'serverpilot:setup:';
const modalPrefix = `${setupPrefix}modal:`;
const requestStore = new Map<string, SetupRequest>();
let requestCounter = 0;
const requestTtlMs = 30 * 60 * 1000;

const safeRolePermissions: Record<string, bigint> = {
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
};

const setupEmbed = new EmbedBuilder()
  .setColor(0x5865f2)
  .setTitle('ServerPilot Setup')
  .setDescription('Choose the type of community you are setting up. ServerPilot will ask what you want and prepare a plan for your review.')
  .addFields({ name: 'What happens next?', value: 'Describe your server, review the generated preview, and confirm before anything is created.' });

function getSetupType(value: string): SetupType | undefined {
  return setupTypes.find((type) => type.toLowerCase() === value);
}

function isAdministrator(interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

function createRequestId() {
  requestCounter = (requestCounter + 1) % 1000;
  return `${Date.now().toString(36)}${requestCounter.toString(36)}`;
}

function storeRequest(request: SetupRequest) {
  requestStore.set(request.requestId, request);
  setTimeout(() => {
    if (requestStore.get(request.requestId) === request) requestStore.delete(request.requestId);
  }, requestTtlMs).unref();
}

function getRequest(requestId: string) {
  const request = requestStore.get(requestId);
  if (!request || request.expiresAt < Date.now()) {
    requestStore.delete(requestId);
    return undefined;
  }
  return request;
}

function setupMenuRow() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(setupSelectId).setPlaceholder('Choose a community type')
      .addOptions(setupTypes.map((type) => ({ label: type === 'Custom' ? 'Other / Custom' : type, value: type.toLowerCase() }))),
  );
}

function descriptionModal(userId: string, type: SetupType, requestId?: string) {
  const id = requestId ? `${modalPrefix}description-edit:${requestId}` : `${modalPrefix}description:${userId}:${type.toLowerCase()}`;
  return new ModalBuilder().setCustomId(id).setTitle(`${type === 'Custom' ? 'Custom' : type} Server Brief`).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId('server-description').setLabel('Tell us what you want your server to be like')
        .setStyle(TextInputStyle.Paragraph).setPlaceholder('For example: I want a Fortnite community with tournaments, LFG, clips, and announcements.')
        .setRequired(true).setMinLength(10).setMaxLength(1000),
    ),
  );
}

function textModal(id: string, title: string, fields: Array<{ id: string; label: string; placeholder: string; required?: boolean }>) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(fields.map((field) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(field.id).setLabel(field.label).setPlaceholder(field.placeholder).setStyle(TextInputStyle.Short).setRequired(field.required ?? true).setMaxLength(100),
  )));
}

function mainButtons(requestId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${setupPrefix}confirm:${requestId}`).setLabel('Confirm Setup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${setupPrefix}edit:${requestId}`).setLabel('Edit Setup').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${setupPrefix}cancel:${requestId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

function editorButtons(requestId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-channels:${requestId}`).setLabel('Channels').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-roles:${requestId}`).setLabel('Roles').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-features:${requestId}`).setLabel('Features').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-description:${requestId}`).setLabel('Description').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-done:${requestId}`).setLabel('Done Editing').setStyle(ButtonStyle.Success),
  );
}

function regenerateButton(requestId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${setupPrefix}regenerate:${requestId}`).setLabel('Regenerate').setStyle(ButtonStyle.Secondary));
}

function backButton(requestId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${setupPrefix}editor:${requestId}`).setLabel('Back to Editor').setStyle(ButtonStyle.Secondary));
}

function planPreview(request: SetupRequest) {
  const text = request.categories.map((category) => `**${category.name}**\n${category.channels.map((channel) => `# ${channel}`).join('\n')}`).join('\n\n');
  const voice = request.voiceCategories.map((category) => `**${category.name}**\n${category.channels.map((channel) => `🔊 ${channel}`).join('\n')}`).join('\n\n');
  const roles = request.roles.map((role) => `**${role.name}**: ${role.permissions.length ? role.permissions.join(', ') : 'normal member access'}`).join('\n');
  const embed = new EmbedBuilder().setColor(0x57f287).setTitle('ServerPilot Setup Preview')
    .setDescription(`**Type:** ${request.type}\n\n**Server brief:**\n${request.description}\n\n${[text, voice].filter(Boolean).join('\n\n')}`)
    .addFields({ name: 'ROLES', value: roles || 'No roles planned.' });
  if (request.categories.some((category) => category.channels.includes('rules')) && request.rules.length) {
    embed.addFields({ name: 'PROPOSED RULES', value: request.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n') });
  }
  if (request.recommendedFeatures.length) embed.addFields({ name: 'Recommended', value: request.recommendedFeatures.join(', ') });
  if (request.skippedFeatures.length) embed.addFields({ name: 'Skipped', value: request.skippedFeatures.join(', ') });
  return embed;
}

function editorEmbed(request: SetupRequest) {
  return new EmbedBuilder().setColor(0x3498db).setTitle('ServerPilot Setup Editor').setDescription('What would you like to change?\n\nAll changes stay in the proposed plan until Confirm Setup is pressed.');
}

function updatePlan(request: SetupRequest, plan: ReturnType<typeof createSetupPlan>) {
  request.categories = plan.categories;
  request.voiceCategories = plan.voiceCategories;
  request.recommendedFeatures = plan.recommendedFeatures;
  request.requestedFeatures = plan.requestedFeatures;
  request.skippedFeatures = plan.skippedFeatures;
  request.roles = plan.roles;
  request.rules = plan.rules;
}

function syncRules(request: SetupRequest) {
  if (!request.categories.some((category) => category.channels.includes('rules'))) {
    request.rules = [];
  } else if (request.rules.length === 0) {
    request.rules = createDefaultRules(request.type, request.description);
  }
}

function rebuildQuestions(request: SetupRequest) {
  request.questions = [...getSetupQuestions(request.type, request.description), ...getRoleQuestions(request.type, request.description)];
  request.questionIndex = 0;
}

function categoriesFor(request: SetupRequest) {
  return [...request.categories, ...request.voiceCategories];
}

function categoryMenu(request: SetupRequest, customId: string, placeholder: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder)
    .addOptions(categoriesFor(request).map((category, index) => ({ label: category.name.slice(0, 100), value: String(index) }))));
}

function proposedCategorySelect(request: SetupRequest, action: 'remove' | 'rename') {
  return categoryMenu(request, `${setupPrefix}category-select:${action}:${request.requestId}`, `Select a category to ${action}`);
}

async function showMissingPermissions(interaction: StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction, missing: string[]) {
  const response = { content: `ServerPilot cannot continue because it is missing: ${missing.join(', ')}. Grant these permissions and try again.`, ephemeral: true };
  if (interaction.deferred || interaction.replied) await interaction.followUp(response);
  else await interaction.reply(response);
}

async function showPreview(interaction: ModalSubmitInteraction | ButtonInteraction, request: SetupRequest) {
  const fallback = createSetupPlan(request.type, request.description, request.answers);
  const checkedPlan = applyExplicitSetupIntent(
    request,
    extractSetupIntent(request.type, request.description),
    fallback,
    request.manualEdits.length > 0,
  );
  updatePlan(request, checkedPlan);
  storeRequest(request);
  const payload = { embeds: [planPreview(request)], components: [mainButtons(request.requestId)], content: '' };
  if (interaction.deferred) await interaction.editReply(payload);
  else if (interaction.isModalSubmit()) await interaction.reply(payload);
  else await interaction.update(payload);
}

async function showEditor(interaction: ButtonInteraction, request: SetupRequest) {
  await interaction.update({ embeds: [editorEmbed(request)], components: [editorButtons(request.requestId), regenerateButton(request.requestId)], content: '' });
}

async function showEditorFromModal(interaction: ModalSubmitInteraction, request: SetupRequest) {
  storeRequest(request);
  await interaction.reply({ embeds: [editorEmbed(request)], components: [editorButtons(request.requestId), regenerateButton(request.requestId)] });
}

async function showEditorFromSelect(interaction: StringSelectMenuInteraction, request: SetupRequest) {
  await interaction.update({ embeds: [editorEmbed(request)], components: [editorButtons(request.requestId), regenerateButton(request.requestId)], content: '' });
}

function editorSubmenu(requestId: string, label: string, buttons: Array<[string, string, ButtonStyle]>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.map(([action, text, style]) => new ButtonBuilder().setCustomId(`${setupPrefix}${action}:${requestId}`).setLabel(text).setStyle(style)));
}

async function showChannelEditor(interaction: ButtonInteraction, request: SetupRequest) {
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('Edit Channels').setDescription('Choose a channel action. Changes are temporary until confirmation.')], components: [editorSubmenu(request.requestId, '', [['channel-add', 'Add Channel', ButtonStyle.Primary], ['channel-remove', 'Remove Channel', ButtonStyle.Danger], ['channel-rename', 'Rename Channel', ButtonStyle.Secondary], ['category-edit', 'Categories', ButtonStyle.Secondary]]), backButton(request.requestId)], content: '' });
}

async function showRoleEditor(interaction: ButtonInteraction, request: SetupRequest) {
  await interaction.update({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('Edit Roles').setDescription('Choose a role action. Existing Discord roles are never changed during editing.')], components: [editorSubmenu(request.requestId, '', [['role-add', 'Add Role', ButtonStyle.Primary], ['role-remove', 'Remove Role', ButtonStyle.Danger], ['role-rename', 'Rename Role', ButtonStyle.Secondary], ['role-permissions', 'Permissions', ButtonStyle.Secondary]]), backButton(request.requestId)], content: '' });
}

async function showFeatureEditor(interaction: ButtonInteraction, request: SetupRequest, page = 0) {
  const questions = [...getSetupQuestions(request.type, request.description), ...getRoleQuestions(request.type, request.description)];
  const pageCount = Math.max(1, Math.ceil(questions.length / 4));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const pageQuestions = questions.slice(currentPage * 4, (currentPage + 1) * 4);
  const rows = pageQuestions.map((question) => editorSubmenu(request.requestId, '', [['feature-question', question.label.slice(0, 80), ButtonStyle.Primary]])).map((row, index) => {
    const button = row.components[0];
    const questionId = pageQuestions[index]?.id ?? '';
    if (button) { button.setLabel('Yes').setStyle(ButtonStyle.Success).setCustomId(`${setupPrefix}feature:${request.requestId}:${questionId}:yes`); }
    row.addComponents(
      new ButtonBuilder().setCustomId(`${setupPrefix}feature:${request.requestId}:${questionId}:no`).setLabel('No').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${setupPrefix}feature:${request.requestId}:${questionId}:decide`).setLabel('Decide for me').setStyle(ButtonStyle.Primary),
    );
    return row;
  });
  const navigation = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-features:${request.requestId}:${currentPage - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor-features:${request.requestId}:${currentPage + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= pageCount - 1),
    new ButtonBuilder().setCustomId(`${setupPrefix}editor:${request.requestId}`).setLabel('Back to Editor').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({
    embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('Edit Features').setDescription(questions.length ? `Choose a feature question to change. Page ${currentPage + 1} of ${pageCount}.` : 'No unresolved feature questions remain for this description.')],
    components: [...rows, navigation],
    content: '',
  });
}

function channelSelect(request: SetupRequest, action: 'remove' | 'rename') {
  const options: { label: string; value: string }[] = [];
  request.categories.forEach((category, categoryIndex) => category.channels.forEach((name, channelIndex) => options.push({ label: `# ${name}`.slice(0, 100), value: `text:${categoryIndex}:${channelIndex}` })));
  request.voiceCategories.forEach((category, categoryIndex) => category.channels.forEach((name, channelIndex) => options.push({ label: `🔊 ${name}`.slice(0, 100), value: `voice:${categoryIndex}:${channelIndex}` })));
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${setupPrefix}channel-select:${action}:${request.requestId}`).setPlaceholder(`Select a channel to ${action}`).addOptions(options.slice(0, 25)));
}

function roleSelect(request: SetupRequest, action: 'remove' | 'rename' | 'permissions') {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${setupPrefix}role-select:${action}:${request.requestId}`).setPlaceholder(`Select a role to ${action}`).addOptions(request.roles.map((role, index) => ({ label: role.name.slice(0, 100), value: String(index) })).slice(0, 25)));
}

async function handleDescription(interaction: ModalSubmitInteraction, request?: SetupRequest) {
  const description = interaction.fields.getTextInputValue('server-description').trim();
  if (!description) return interaction.reply({ content: 'A description is required.', ephemeral: true });
  if (request) {
    await interaction.deferReply();
    request.description = description;
    const plan = await generateSetupPlan(request.type, description, request.answers);
    updatePlan(request, plan);
    rebuildQuestions(request);
    request.manualEdits.push('description changed and proposal regenerated');
    return showPreview(interaction, request);
  }
  const [, , , , userId, typeValue] = interaction.customId.split(':');
  const type = getSetupType(typeValue ?? '');
  if (!type || userId !== interaction.user.id || !interaction.guild) return interaction.reply({ content: 'This setup request is not valid. Please run /setup again.', ephemeral: true });
  await interaction.deferReply();
  const plan = await generateSetupPlan(type, description);
  const newRequest: SetupRequest = { ...plan, requestId: createRequestId(), guildId: interaction.guild.id, userId: interaction.user.id, answers: {}, questions: [...getSetupQuestions(type, description), ...getRoleQuestions(type, description)], questionIndex: 0, originalPlan: structuredClone(plan), manualEdits: [], expiresAt: Date.now() + requestTtlMs };
  storeRequest(newRequest);
  const question = newRequest.questions[0];
  if (question) return showQuestion(interaction, newRequest, question);
  return showPreview(interaction, newRequest);
}

async function showQuestion(interaction: ModalSubmitInteraction | ButtonInteraction, request: SetupRequest, question: SetupQuestion) {
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('A quick setup question').setDescription(question.label).setFooter({ text: `Question ${request.questionIndex + 1} of ${request.questions.length}` });
  const row = editorSubmenu(request.requestId, '', [['feature', 'Yes', ButtonStyle.Success]]);
  const yesButton = row.components[0];
  if (yesButton) yesButton.setCustomId(`${setupPrefix}feature:${request.requestId}:${question.id}:yes`);
  row.addComponents(new ButtonBuilder().setCustomId(`${setupPrefix}feature:${request.requestId}:${question.id}:no`).setLabel('No').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`${setupPrefix}feature:${request.requestId}:${question.id}:decide`).setLabel('Decide for me').setStyle(ButtonStyle.Primary));
  if (interaction.deferred) await interaction.editReply({ embeds: [embed], components: [row] });
  else if (interaction.isModalSubmit()) await interaction.reply({ embeds: [embed], components: [row] });
  else await interaction.update({ embeds: [embed], components: [row], content: '' });
}

async function handleTextModal(interaction: ModalSubmitInteraction, request: SetupRequest) {
  const parts = interaction.customId.split(':');
  const action = parts[3];
  if (action === 'description-edit') return handleDescription(interaction, request);
  if (action === 'channel-add') {
    const name = interaction.fields.getTextInputValue('name').trim();
    const type = interaction.fields.getTextInputValue('type').trim().toLowerCase();
    const categoryName = interaction.fields.getTextInputValue('category').trim();
    const categories = type === 'voice' ? request.voiceCategories : request.categories;
    let category = categories.find((item) => item.name.toLowerCase() === categoryName.toLowerCase());
    if (!category) { category = { name: categoryName || (type === 'voice' ? '🔊 VOICE' : '💬 COMMUNITY'), channels: [] }; categories.push(category); }
    if (categoriesFor(request).some((item) => item.channels.some((channel) => channel.toLowerCase() === name.toLowerCase()))) return interaction.reply({ content: 'That proposed channel already exists.', ephemeral: true });
    category.channels.push(name); syncRules(request); request.manualEdits.push(`added ${type} channel ${name}`); return showEditorFromModal(interaction, request);
  }
  if (action === 'channel-rename') {
    const name = interaction.fields.getTextInputValue('name').trim();
    const kind = parts[5]; const categoryIndex = Number(parts[6]); const channelIndex = Number(parts[7]);
    const categories = kind === 'voice' ? request.voiceCategories : request.categories;
    const category = categories[categoryIndex];
    if (categoriesFor(request).some((item) => item.channels.some((channel, index) => channel.toLowerCase() === name.toLowerCase() && !(item === category && index === channelIndex)))) return interaction.reply({ content: 'That proposed channel name is already in use.', ephemeral: true });
    if (category?.channels[channelIndex]) category.channels[channelIndex] = name;
    syncRules(request); request.manualEdits.push('channel renamed'); return showEditorFromModal(interaction, request);
  }
  if (action === 'category-rename' || action === 'role-rename') {
    const name = interaction.fields.getTextInputValue('name').trim(); const index = Number(interaction.fields.getTextInputValue('index'));
    if (action === 'role-rename' && request.roles.some((role, roleIndex) => roleIndex !== index && role.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: 'That proposed role name is already in use.', ephemeral: true });
    if (action === 'category-rename' && categoriesFor(request).some((category, categoryIndex) => categoryIndex !== index && category.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: 'That proposed category name is already in use.', ephemeral: true });
    if (action === 'role-rename' && request.roles[index]) request.roles[index].name = name;
    else if (action === 'category-rename' && categoriesFor(request)[index]) categoriesFor(request)[index]!.name = name;
    request.manualEdits.push(`${action} applied`); return showEditorFromModal(interaction, request);
  }
  if (action === 'category-add') {
    const name = interaction.fields.getTextInputValue('name').trim();
    const type = interaction.fields.getTextInputValue('type').trim().toLowerCase();
    if (categoriesFor(request).some((category) => category.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: 'That proposed category already exists.', ephemeral: true });
    (type === 'voice' ? request.voiceCategories : request.categories).push({ name, channels: [] });
    request.manualEdits.push(`added ${type} category ${name}`); return showEditorFromModal(interaction, request);
  }
  if (action === 'role-add') {
    const name = interaction.fields.getTextInputValue('name').trim(); const purpose = interaction.fields.getTextInputValue('purpose').trim();
    if (request.roles.some((role) => role.name.toLowerCase() === name.toLowerCase())) return interaction.reply({ content: 'That proposed role already exists.', ephemeral: true });
    const requestedPermissions = interaction.fields.getTextInputValue('permissions').split(',').map((item) => item.trim()).filter(Boolean);
    const dangerousPermissions = requestedPermissions.filter((permission) => ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels'].includes(permission));
    if (dangerousPermissions.length) return interaction.reply({ content: `These permissions are too powerful for an editor-created role and were not applied: ${dangerousPermissions.join(', ')}.`, ephemeral: true });
    const permissions = requestedPermissions.filter((item) => safeRolePermissions[item]);
    const value = permissions.reduce((total, permission) => total | (safeRolePermissions[permission] ?? 0n), 0n);
    request.roles.push({ name, purpose, color: 0x95a5a6, permissions, permissionsValue: value.toString(), kind: 'member', recommended: false, explicitlyRequested: true });
    request.manualEdits.push(`added role ${name}`); return showEditorFromModal(interaction, request);
  }
  if (action === 'role-permissions') {
    const index = Number(interaction.fields.getTextInputValue('index')); const permissions = interaction.fields.getTextInputValue('permissions').split(',').map((item) => item.trim()).filter((item) => safeRolePermissions[item]);
    if (request.roles[index]) { request.roles[index].permissions = permissions; request.roles[index].permissionsValue = permissions.reduce((total, permission) => total | (safeRolePermissions[permission] ?? 0n), 0n).toString(); request.manualEdits.push(`changed permissions for ${request.roles[index].name}`); }
    return showEditorFromModal(interaction, request);
  }
  return interaction.reply({ content: 'This edit action is no longer valid.', ephemeral: true });
}

async function handleSelect(interaction: StringSelectMenuInteraction, request: SetupRequest) {
  const parts = interaction.customId.split(':'); const action = parts[3]; const value = interaction.values[0] ?? '';
  if (interaction.customId === `${setupPrefix}type`) return;
  if (parts[2] === 'category-select') {
    const index = Number(value); const categories = categoriesFor(request);
    if (!categories[index]) return interaction.reply({ content: 'That proposed category is no longer available.', ephemeral: true });
    if (action === 'remove') {
      if (index < request.categories.length) request.categories.splice(index, 1);
      else request.voiceCategories.splice(index - request.categories.length, 1);
      syncRules(request);
      request.manualEdits.push('category removed');
      return showEditorFromSelect(interaction, request);
    }
    return interaction.showModal(textModal(`${modalPrefix}category-rename:${request.requestId}`, 'Rename Category', [{ id: 'index', label: 'Category index', placeholder: String(index) }, { id: 'name', label: 'New category name', placeholder: 'Category name' }]));
  }
  if (parts[2] === 'role-select') {
    const index = Number(value);
    if (action === 'remove') {
      const [removed] = request.roles.splice(index, 1); request.manualEdits.push(`removed role ${removed?.name ?? ''}`); return showEditorFromSelect(interaction, request);
    }
    const modalAction = action === 'permissions' ? 'role-permissions' : 'role-rename';
    return interaction.showModal(textModal(`${modalPrefix}${modalAction}:${request.requestId}`, modalAction === 'role-permissions' ? 'Edit Role Permissions' : 'Rename Role', [{ id: 'index', label: 'Role index', placeholder: String(index) }, ...(modalAction === 'role-permissions' ? [{ id: 'permissions', label: 'Safe permissions, comma separated', placeholder: 'ManageMessages, ModerateMembers' }] : [{ id: 'name', label: 'New role name', placeholder: 'Role name' }])]));
  }
  if (action === 'remove' || action === 'rename') {
    const [kind, categoryIndex, channelIndex] = value.split(':'); const categories = kind === 'voice' ? request.voiceCategories : request.categories; const category = categories[Number(categoryIndex)];
    if (!category) return interaction.reply({ content: 'That proposed channel is no longer available.', ephemeral: true });
    if (action === 'remove') { const [removed] = category.channels.splice(Number(channelIndex), 1); syncRules(request); request.manualEdits.push(`removed channel ${removed}`); return showEditorFromSelect(interaction, request); }
    return interaction.showModal(textModal(`${modalPrefix}channel-rename:${request.requestId}:${kind}:${categoryIndex}:${channelIndex}`, 'Rename Channel', [{ id: 'name', label: 'New channel name', placeholder: 'new-channel-name' }]));
  }
  if (parts[2] === 'feature') {
    const questionId = parts[4] ?? ''; const answer = parts[5] as SetupAnswers[string]; request.answers[questionId] = answer; const plan = applySetupAnswer(request, request.type, request.description, request.answers, questionId); updatePlan(request, plan); syncRules(request); request.manualEdits.push(`feature ${questionId} set to ${answer}`); return showEditorFromSelect(interaction, request);
  }
  return interaction.reply({ content: 'This selection is no longer valid.', ephemeral: true });
}

async function handleButton(interaction: ButtonInteraction, request: SetupRequest) {
  const parts = interaction.customId.split(':');
  const action = parts[2];
  if (action === 'feature') {
    const questionId = parts[4] ?? ''; const answer = parts[5] as SetupAnswers[string];
    request.answers[questionId] = answer;
    const currentQuestion = request.questions[request.questionIndex];
    if (currentQuestion?.id === questionId) request.questionIndex += 1;
    const nextPlan = applySetupAnswer(request, request.type, request.description, request.answers, questionId);
    updatePlan(request, nextPlan);
    syncRules(request);
    request.manualEdits.push(`feature ${questionId} set to ${answer}`);
    const nextQuestion = request.questions[request.questionIndex];
    if (nextQuestion) return showQuestion(interaction, request, nextQuestion);
    return showPreview(interaction, request);
  }
  if (action === 'edit' || action === 'editor') return showEditor(interaction, request);
  if (action === 'editor-channels') return showChannelEditor(interaction, request);
  if (action === 'editor-roles') return showRoleEditor(interaction, request);
  if (action === 'editor-features') return showFeatureEditor(interaction, request, Number(parts[4] ?? 0));
  if (action === 'editor-description') return interaction.showModal(descriptionModal(interaction.user.id, request.type, request.requestId));
  if (action === 'editor-done') return showPreview(interaction, request);
  if (action === 'cancel') { requestStore.delete(request.requestId); return interaction.update({ content: 'Setup cancelled. No changes were made.', embeds: [], components: [] }); }
  if (action === 'channel-add') return interaction.showModal(textModal(`${modalPrefix}channel-add:${request.requestId}`, 'Add Channel', [{ id: 'name', label: 'Channel name', placeholder: 'community-chat' }, { id: 'type', label: 'Text or Voice', placeholder: 'text' }, { id: 'category', label: 'Category name', placeholder: '💬 COMMUNITY', required: false }]));
  if (action === 'channel-remove' || action === 'channel-rename') return interaction.update({ embeds: [new EmbedBuilder().setTitle(`Edit ${action === 'channel-remove' ? 'Remove' : 'Rename'} Channel`)], components: [channelSelect(request, action === 'channel-remove' ? 'remove' : 'rename'), backButton(request.requestId)], content: '' });
  if (action === 'category-edit') return interaction.update({ embeds: [new EmbedBuilder().setTitle('Edit Categories')], components: [editorSubmenu(request.requestId, '', [['category-add', 'Add Category', ButtonStyle.Primary], ['category-remove', 'Remove Category', ButtonStyle.Danger], ['category-rename', 'Rename Category', ButtonStyle.Secondary]]), backButton(request.requestId)], content: '' });
  if (action === 'category-add') return interaction.showModal(textModal(`${modalPrefix}category-add:${request.requestId}`, 'Add Category', [{ id: 'name', label: 'Category name', placeholder: '📁 NEW CATEGORY' }, { id: 'type', label: 'Text or Voice channels', placeholder: 'text', required: false }]));
  if (action === 'category-remove' || action === 'category-rename') return interaction.update({ embeds: [new EmbedBuilder().setTitle('Select Proposed Category')], components: [proposedCategorySelect(request, action === 'category-remove' ? 'remove' : 'rename'), backButton(request.requestId)], content: '' });
  if (action === 'role-add') return interaction.showModal(textModal(`${modalPrefix}role-add:${request.requestId}`, 'Add Role', [{ id: 'name', label: 'Role name', placeholder: 'Event Staff' }, { id: 'purpose', label: 'Purpose', placeholder: 'Coordinate events' }, { id: 'permissions', label: 'Safe permissions, comma separated', placeholder: 'ManageMessages', required: false }]));
  if (action === 'role-remove' || action === 'role-rename' || action === 'role-permissions') return interaction.update({ embeds: [new EmbedBuilder().setTitle('Select Proposed Role')], components: [roleSelect(request, action === 'role-remove' ? 'remove' : action === 'role-rename' ? 'rename' : 'permissions'), backButton(request.requestId)], content: '' });
  if (action === 'regenerate') return interaction.update({ embeds: [new EmbedBuilder().setTitle('Regenerate proposal?').setDescription('Regenerating may replace some of your manual changes.')], components: [editorSubmenu(request.requestId, '', [['regenerate-confirm', 'Regenerate', ButtonStyle.Danger], ['regenerate-keep', 'Keep My Changes', ButtonStyle.Secondary]])], content: '' });
  if (action === 'regenerate-confirm') {
    await interaction.deferUpdate();
    const plan = await generateSetupPlan(request.type, request.description, request.answers);
    updatePlan(request, plan);
    request.manualEdits.push('proposal regenerated');
    return showPreview(interaction, request);
  }
  if (action === 'regenerate-keep') return showEditor(interaction, request);
  if (action === 'confirm') {
    if (!interaction.guild || interaction.guild.id !== request.guildId) return interaction.reply({ content: 'This setup action is no longer valid.', ephemeral: true });
    await interaction.deferUpdate();
    const missing = await getMissingBotPermissions(interaction.guild); if (missing.length) return showMissingPermissions(interaction, missing);
    try { const result = await createSetupStructure(interaction.guild, request); requestStore.delete(request.requestId); return interaction.editReply({ content: `Setup complete. Created ${result.createdCategories} categories, ${result.createdChannels} channels, and ${result.roles.created.length} roles. Reused roles: ${result.roles.reused.length}.`, embeds: [], components: [] }); }
    catch (error) { const detail = error instanceof DiscordAPIError ? ` Discord error ${error.code}.` : ''; return interaction.editReply({ content: `Setup could not be completed.${detail} Changes made before the failure remain; no destructive changes were performed.`, embeds: [], components: [] }); }
  }
  return interaction.reply({ content: 'This setup action is no longer valid.', ephemeral: true });
}

export const setupCommand = {
  data: new SlashCommandBuilder().setName('setup').setDescription('Start the ServerPilot community setup flow.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isAdministrator(interaction)) return interaction.reply({ content: 'Only server administrators can use /setup.', ephemeral: true });
    return interaction.reply({ embeds: [setupEmbed], components: [setupMenuRow()] });
  },
};

export async function handleSetupInteraction(interaction: Interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isModalSubmit() && !interaction.isButton()) return;
  if (!isAdministrator(interaction)) return interaction.reply({ content: 'Only server administrators can use this setup flow.', ephemeral: true });
  if (interaction.isStringSelectMenu() && interaction.customId === setupSelectId) {
    const type = getSetupType(interaction.values[0] ?? '');
    if (!type || !interaction.guild) return interaction.reply({ content: 'That setup selection is not valid.', ephemeral: true });
    return interaction.showModal(descriptionModal(interaction.user.id, type));
  }
  if (interaction.isModalSubmit()) {
    const parts = interaction.customId.split(':');
    if (parts[2] !== 'modal') return interaction.reply({ content: 'This setup action is no longer valid.', ephemeral: true });
    if (parts[3] === 'description') return handleDescription(interaction);
    const request = getRequest(parts[4] ?? '');
    if (!request || request.userId !== interaction.user.id || !interaction.guild || request.guildId !== interaction.guild.id) return interaction.reply({ content: 'This setup session has expired or belongs to another administrator. Run /setup again.', ephemeral: true });
    return handleTextModal(interaction, request);
  }
  const requestId = interaction.isStringSelectMenu() ? interaction.customId.split(':')[4] : interaction.customId.split(':')[3];
  const request = getRequest(requestId ?? '');
  if (!request || request.userId !== interaction.user.id || !interaction.guild || request.guildId !== interaction.guild.id) return interaction.reply({ content: 'This setup session has expired or belongs to another administrator. Run /setup again.', ephemeral: true });
  if (interaction.isStringSelectMenu()) return handleSelect(interaction, request);
  return handleButton(interaction, request);
}
