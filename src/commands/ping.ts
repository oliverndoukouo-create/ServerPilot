import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether ServerPilot is online.'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply('🏓 Pong! ServerPilot is online.');
  },
};