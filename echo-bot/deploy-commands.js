import dotenv from "dotenv";
import { REST, Routes, SlashCommandBuilder, ChannelType } from "discord.js";
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName("echo")
    .setDescription("Manage channel echo feeds (moderators only).")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Add an echo from a source channel to a target channel.")
        .addChannelOption(o =>
          o.setName("source")
            .setDescription("Channel to read messages from")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption(o =>
          o.setName("target")
            .setDescription("Channel to echo messages into")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("name")
            .setDescription("Optional feed label (e.g. 'general chat feed')")
            .setRequired(false)
        )
        .addStringOption(o =>
          o.setName("color")
            .setDescription("Optional hex color like #ff9900")
            .setRequired(false)
        )
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove a specific echo link.")
        .addChannelOption(o =>
          o.setName("source")
            .setDescription("Source channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption(o =>
          o.setName("target")
            .setDescription("Target channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("List all echo links in this server.")
    )
    .addSubcommand(s =>
      s.setName("off")
        .setDescription("Disable all echoing from a source channel.")
        .addChannelOption(o =>
          o.setName("source")
            .setDescription("Source channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("on")
        .setDescription("Re-enable echoing from a source channel.")
        .addChannelOption(o =>
          o.setName("source")
            .setDescription("Source channel")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  const { CLIENT_ID, GUILD_ID } = process.env;
  if (!CLIENT_ID || !GUILD_ID) throw new Error("Missing CLIENT_ID or GUILD_ID in .env");

  // Guild deploy = instant updates (best for testing)
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✅ Slash commands deployed to guild.");
}

main().catch(console.error);
