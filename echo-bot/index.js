import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
} from "discord.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, "echo-config.json");

function defaultConfig() {
  return {
    version: 1,
    links: [],
    // ✅ now per-guild: { [guildId]: [channelId, channelId, ...] }
    disabledSources: {},
  };
}

function migrateConfig(cfg) {
  // If disabledSources used to be an array, migrate it to the new object format.
  if (Array.isArray(cfg.disabledSources)) {
    // We can't reliably map those old channel IDs to a specific guild without more info,
    // so we preserve them under a special key to avoid data loss.
    cfg.disabledSources = { _migrated_unknown_guild: cfg.disabledSources };
  }

  if (!cfg.disabledSources || typeof cfg.disabledSources !== "object") {
    cfg.disabledSources = {};
  }
  if (!Array.isArray(cfg.links)) cfg.links = [];
  if (!cfg.version) cfg.version = 1;

  return cfg;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const d = defaultConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(d, null, 2));
    return d;
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const migrated = migrateConfig(cfg);
  // Write back if migration changed shape
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2));
  return migrated;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function isModerator(member) {
  return (
    member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    member.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

// Accepts: "#ff0000" OR "ff0000"
function parseHexColor(input) {
  if (!input) return null;
  const v = input.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
  return parseInt(v, 16);
}

function summarizeAttachments(message) {
  if (!message.attachments || message.attachments.size === 0) return null;
  const lines = [];
  for (const [, att] of message.attachments) {
    lines.push(`📎 [${att.name ?? "attachment"}](${att.url})`);
  }
  return lines.join("\n");
}

function summarizeStickers(message) {
  if (!message.stickers || message.stickers.size === 0) return null;
  const names = message.stickers.map((s) => s.name).filter(Boolean);
  return names.length ? `🎟️ Stickers: ${names.join(", ")}` : null;
}

function getDisabledListForGuild(cfg, guildId) {
  const list = cfg.disabledSources?.[guildId];
  return Array.isArray(list) ? list : [];
}

function ensureGuildDisabledList(cfg, guildId) {
  if (!cfg.disabledSources[guildId]) cfg.disabledSources[guildId] = [];
  if (!Array.isArray(cfg.disabledSources[guildId])) cfg.disabledSources[guildId] = [];
  return cfg.disabledSources[guildId];
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // enable in Dev Portal
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Echo messages
client.on("messageCreate", async (message) => {
  try {
    if (message.author?.bot) return;
    if (!message.guild) return;

    const cfg = loadConfig();
    const guildId = message.guildId;
    const sourceId = message.channelId;

    // ✅ per-guild disabled list
    const disabled = getDisabledListForGuild(cfg, guildId);
    if (disabled.includes(sourceId)) return;

    // Find matching links for this guild + source
    const links = cfg.links.filter(
      (l) =>
        l.guildId === guildId &&
        l.sourceChannelId === sourceId &&
        l.enabled !== false
    );
    if (links.length === 0) return;

    for (const link of links) {
      const target = await message.guild.channels.fetch(link.targetChannelId).catch(() => null);
      if (!target) continue;
      if (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement) continue;

      const feedLabel = link.feedName?.trim() ? ` • ${link.feedName.trim()}` : "";
      const color = typeof link.color === "number" ? link.color : 0x2b2d31;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({
          name: `${message.author.username}${feedLabel}`,
          iconURL: message.author.displayAvatarURL({ size: 64 }),
        })
        .setTimestamp(new Date(message.createdTimestamp));

      const content = message.content?.trim();
      const attachments = summarizeAttachments(message);
      const stickers = summarizeStickers(message);

      const parts = [];
      if (content) parts.push(content);
      if (attachments) parts.push(attachments);
      if (stickers) parts.push(stickers);

      let desc = parts.length ? parts.join("\n\n") : "(no text content)";
      if (desc.length > 3900) desc = desc.slice(0, 3900) + "…";

      embed.setDescription(desc);
      embed.setFooter({
        text: `From #${message.channel?.name ?? "unknown"} • ID ${message.author.id}`,
      });

      await target.send({ embeds: [embed] }).catch(() => null);
    }
  } catch (err) {
    console.error("Echo error:", err);
  }
});

// Slash commands handling
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "echo") return;

  if (!interaction.inGuild()) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  const member = interaction.member;
  if (!isModerator(member)) {
    return interaction.reply({ content: "❌ You must be a moderator to use this command.", ephemeral: true });
  }

  const sub = interaction.options.getSubcommand();
  const cfg = loadConfig();
  const guildId = interaction.guildId;

  if (sub === "add") {
    const source = interaction.options.getChannel("source", true);
    const target = interaction.options.getChannel("target", true);
    const name = interaction.options.getString("name", false) ?? "";
    const colorInput = interaction.options.getString("color", false);
    const color = parseHexColor(colorInput);

    if (source.type !== ChannelType.GuildText && source.type !== ChannelType.GuildAnnouncement) {
      return interaction.reply({ content: "Source must be a text/announcement channel.", ephemeral: true });
    }
    if (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement) {
      return interaction.reply({ content: "Target must be a text/announcement channel.", ephemeral: true });
    }
    if (colorInput && color === null) {
      return interaction.reply({ content: "Color must be a 6-digit hex like `#ff9900`.", ephemeral: true });
    }

    const exists = cfg.links.some(
      (l) => l.guildId === guildId && l.sourceChannelId === source.id && l.targetChannelId === target.id
    );
    if (exists) {
      return interaction.reply({ content: "That echo link already exists.", ephemeral: true });
    }

    cfg.links.push({
      guildId,
      sourceChannelId: source.id,
      targetChannelId: target.id,
      feedName: name,
      color: color ?? undefined,
      enabled: true,
      createdAt: new Date().toISOString(),
    });

    saveConfig(cfg);

    return interaction.reply({
      content:
        `✅ Echo added: **#${source.name} → #${target.name}**` +
        (name ? ` (name: **${name}**)` : "") +
        (color ? ` (color: **#${colorInput.replace("#", "")}**)` : ""),
      ephemeral: true,
    });
  }

  if (sub === "list") {
    const guildLinks = cfg.links.filter((l) => l.guildId === guildId);

    if (guildLinks.length === 0) {
      return interaction.reply({ content: "No echo links set up yet.", ephemeral: true });
    }

    const lines = guildLinks.map((l, i) => {
      const src = `<#${l.sourceChannelId}>`;
      const tgt = `<#${l.targetChannelId}>`;
      const nm = l.feedName?.trim() ? ` • **${l.feedName.trim()}**` : "";
      const col = typeof l.color === "number" ? ` • \`#${l.color.toString(16).padStart(6, "0")}\`` : "";
      const en = l.enabled === false ? " • ❌ disabled" : " • ✅ enabled";
      return `${i + 1}. ${src} → ${tgt}${nm}${col}${en}`;
    });

    const disabled = getDisabledListForGuild(cfg, guildId);
    const disabledLine = disabled.length
      ? `\n\n**Sources disabled in this server:**\n${disabled.map((id) => `<#${id}>`).join(", ")}`
      : "";

    return interaction.reply({
      content: `**Echo links (this server):**\n${lines.join("\n")}${disabledLine}`,
      ephemeral: true,
    });
  }

  if (sub === "remove") {
    const source = interaction.options.getChannel("source", true);
    const target = interaction.options.getChannel("target", true);

    const before = cfg.links.length;
    cfg.links = cfg.links.filter(
      (l) => !(l.guildId === guildId && l.sourceChannelId === source.id && l.targetChannelId === target.id)
    );

    if (cfg.links.length === before) {
      return interaction.reply({ content: "No matching link found to remove.", ephemeral: true });
    }

    saveConfig(cfg);
    return interaction.reply({
      content: `🗑️ Removed echo: **#${source.name} → #${target.name}**`,
      ephemeral: true,
    });
  }

  if (sub === "off") {
    const source = interaction.options.getChannel("source", true);
    const list = ensureGuildDisabledList(cfg, guildId);

    if (!list.includes(source.id)) list.push(source.id);

    saveConfig(cfg);
    return interaction.reply({ content: `⛔ Echoing disabled for **#${source.name}** (this server)`, ephemeral: true });
  }

  if (sub === "on") {
    const source = interaction.options.getChannel("source", true);
    const list = ensureGuildDisabledList(cfg, guildId);

    cfg.disabledSources[guildId] = list.filter((id) => id !== source.id);

    saveConfig(cfg);
    return interaction.reply({ content: `✅ Echoing enabled for **#${source.name}** (this server)`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
