import {
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';

export const serverCommand = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('View information about this Discord server.'),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'The /server command can only be used inside a Discord server.',
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild;
    const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildVoice).size;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${guild.name} Server Information`)
      .setDescription('Current information provided by Discord.')
      .addFields(
        { name: 'Server ID', value: guild.id, inline: true },
        { name: 'Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
        { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
        { name: 'Text Channels', value: textChannels.toString(), inline: true },
        { name: 'Voice Channels', value: voiceChannels.toString(), inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: false },
        { name: 'ServerPilot Status', value: '🟢 Online and operational', inline: false },
      )
      .setFooter({ text: 'ServerPilot' });

    await interaction.reply({ embeds: [embed] });
  },
};
