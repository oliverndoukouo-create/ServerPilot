import { ChannelType, type Guild } from 'discord.js';
import { createRoles } from './role-creator.js';
import type { SetupPlan } from './types.js';

export async function createSetupStructure(guild: Guild, plan: SetupPlan) {
  const channels = await guild.channels.fetch();
  let createdCategories = 0;
  let createdChannels = 0;

  for (const categoryDefinition of plan.categories) {
    let category = channels.find(
      (channel) => channel?.type === ChannelType.GuildCategory && channel.name === categoryDefinition.name,
    );

    if (!category) {
      category = await guild.channels.create({ name: categoryDefinition.name, type: ChannelType.GuildCategory });
      channels.set(category.id, category);
      createdCategories += 1;
    }

    for (const channelName of categoryDefinition.channels) {
      const existingChannel = channels.find(
        (channel) => channel?.type === ChannelType.GuildText && channel.name === channelName,
      );

      if (existingChannel) {
        continue;
      }

      const createdChannel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id });
      channels.set(createdChannel.id, createdChannel);
      createdChannels += 1;
      if (channelName === 'rules' && plan.rules.length > 0) {
        await createdChannel.send({
          content: `**Server Rules**\n${plan.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`,
          allowedMentions: { parse: [] },
        });
      }
    }
  }

  for (const voiceCategoryDefinition of plan.voiceCategories) {
    let category = channels.find(
      (channel) => channel?.type === ChannelType.GuildCategory && channel.name === voiceCategoryDefinition.name,
    );

    if (!category) {
      category = await guild.channels.create({ name: voiceCategoryDefinition.name, type: ChannelType.GuildCategory });
      channels.set(category.id, category);
      createdCategories += 1;
    }

    for (const channelName of voiceCategoryDefinition.channels) {
      const existingChannel = channels.find(
        (channel) => channel?.type === ChannelType.GuildVoice && channel.name === channelName,
      );

      if (existingChannel) {
        continue;
      }

      const createdChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: category.id,
      });
      channels.set(createdChannel.id, createdChannel);
      createdChannels += 1;
    }
  }

  const roles = await createRoles(guild, plan.roles);

  return { createdCategories, createdChannels, roles };
}