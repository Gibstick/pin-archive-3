/**
 * Pin archiving logic
 */
import { SlashCommandBuilder } from "@discordjs/builders";
import bunyan from "bunyan";
import { assert } from "console";
import { ChannelType } from "discord-api-types/v9";
import {
  Client,
  Command,
  CommandInteraction,
  Message,
  MessageEmbed,
  MessageReaction,
  Permissions,
  TextChannel,
} from "discord.js";
import { Database } from "sqlite";
import sqlite3 from "sqlite3";

const OPTION_PIN_ARCHIVE_CHANNEL = "pin-archive-channel";
const OPTION_REACT_COUNT = "react-count";

type DB = Database<sqlite3.Database, sqlite3.Statement>;

const log = bunyan.createLogger({ name: "pin-archive" });

const getReactCount = async (db: DB, guildId: string): Promise<number | undefined> => {
  const result = await db.get<{ react_count: number }>(
    "SELECT react_count FROM config WHERE guild_id = ?",
    guildId,
  );
  return result?.react_count;
};

const getReactTrigger = async (db: DB, guildId: string): Promise<string | undefined> => {
  const result = await db.get<{ react_trigger: string }>(
    "SELECT react_trigger FROM config WHERE guild_id = ?",
    guildId,
  );
  return result?.react_trigger;
};

const getReactCountCommand = async (interaction: CommandInteraction, db: DB) => {
  if (!interaction.inGuild()) {
    return;
  }
  const guildId = interaction.guildId;

  let count: number | undefined;
  try {
    count = await getReactCount(db, guildId);
  } catch (error) {
    log.error("unable to get reaction count for guild %s", guildId);
    interaction.reply({ content: "❗ Failed to fetch reaction count", ephemeral: true });
  }

  if (count === undefined) {
    log.info("getreactcount used while uninitialized in %s", guildId);
    return interaction.reply({ content: "❗ Bot is not initialized. Please use /init.", ephemeral: true });
  }
  return await interaction.reply({ content: `ℹ️ Reaction count is ${count}` });
};

const initCommand = async (interaction: CommandInteraction, db: DB) => {
  if (!interaction.inGuild()) return;
  const channelOption = interaction.options.getChannel(OPTION_PIN_ARCHIVE_CHANNEL, true);
  const guild = await interaction.guild!.fetch();
  const pinChannel = await (await guild.channels.fetch(channelOption.id))?.fetch();

  if (pinChannel === undefined) {
    return await interaction.reply({
      content: `❗ Channel ${channelOption.name} not found`,
      ephemeral: true,
    });
  }

  if (!pinChannel.permissionsFor(interaction.user.id)?.has(Permissions.FLAGS.SEND_MESSAGES)) {
    return await interaction.reply({
      content: "❗ You must have send permissions in the archive channel.",
      ephemeral: true,
    });
  }

  const update = db.run(
    `
    INSERT INTO config(guild_id, archive_channel_id) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET archive_channel_id=excluded.archive_channel_id;
    `,
    guild.id,
    pinChannel.id,
  );

  try {
    await update;
  } catch (error) {
    log.error(error);
    return await interaction.reply({
      content: `❗ Unable to initialize. Please contact bot author.`,
      ephemeral: true,
    });
  }

  log.info("Initialized in guild %s to %s", guild.id, pinChannel.id);
  return await interaction.reply(
    `✅ Initialized pin archive channel to <#${pinChannel.id}>. Don't forget to set permissions on the channel for the bot.`,
  );
};

const setReactCountCommand = async (interaction: CommandInteraction, db: DB) => {
  if (!interaction.inGuild()) {
    return;
  }
  const guildId = interaction.guildId;
  const reactCount = interaction.options.getInteger(OPTION_REACT_COUNT, true);

  const result = db.run(
    `
    UPDATE config
    SET react_count = ?
    WHERE guild_id = ?;
    `,
    reactCount,
    guildId,
  );

  let rowsModified: number;
  try {
    rowsModified = (await result).changes ?? 0;
  } catch (error) {
    log.error("unable to get reaction count for guild %s", guildId);
    return interaction.reply({ content: "❗ Failed to fetch reaction count", ephemeral: true });
  }

  if (rowsModified === 0) {
    log.info("setreactcount used while uninitialized in %s", guildId);
    return interaction.reply({ content: "❗ Bot is not initialized. Please use /init.", ephemeral: true });
  }

  return interaction.reply(`✅ Set reaction count to ${reactCount}`);
};

const formatEmbeds = (message: Message) => {
  assert(!message.partial);
  const channel = message.guild?.channels.cache.get(message.channelId);
  if (channel === undefined) {
    log.error("Unable to get channel with id %s in guild %s", message.channelId, message.guildId);
    return;
  }

  const firstEmbed: MessageEmbed | undefined = message.embeds[0];

  const mainEmbed = new MessageEmbed()
    .setAuthor({
      name: `${message.member!.displayName}#${message.author.discriminator}`,
      iconURL: message.member!.displayAvatarURL(),
      url: message.url,
    })
    .setURL(message.url)
    .setFooter(`Sent in ${channel.name}`)
    .setTimestamp(message.createdTimestamp)
    .setDescription(message.content);

  // If we only have one embed and no attachments, merge that into the main
  // embed. If we only have one image attachment and no embeds, merge that into
  // the main embed.  Otherwise, just throw all of the embeds and attachments as
  // separate embeds (attachments get transformed into basic embeds).
  const firstAttachment = message.attachments.first();
  if (message.embeds.length === 1 && message.attachments.size === 0) {
    if (firstEmbed.image || firstEmbed.thumbnail) {
      mainEmbed.setImage(firstEmbed.image?.url ?? firstEmbed.thumbnail?.url ?? "");
    }
    if (firstEmbed.title) {
      mainEmbed.addField(firstEmbed.title, firstEmbed.description ?? "", false);
    }
    if (firstEmbed.url && firstEmbed.url !== message.content) {
      mainEmbed.addField("🔗", firstEmbed.url, false);
    }
    return [mainEmbed];
  } else if (
    message.attachments.size === 1 &&
    message.embeds.length === 0 &&
    firstAttachment?.contentType?.startsWith("image/")
  ) {
    mainEmbed.setImage(firstAttachment.url);
    return [mainEmbed];
  } else if (message.attachments.size > 0 && message.embeds.length > 0) {
    mainEmbed.addField("See attached", "🔗");
    return [
      mainEmbed,
      ...message.embeds.slice(1),
      ...message.attachments.map((attachment) => {
        const embed = new MessageEmbed().setTitle("🔗").setURL(attachment.url).setDescription(attachment.url);
        if (attachment.contentType?.startsWith("image/")) {
          embed.setImage(attachment.proxyURL);
        }
        return embed;
      }),
    ];
  } else {
    return [mainEmbed];
  }
};

const archiveMessage = async (message: Message, db: DB) => {
  if (!message.inGuild || !message.guild) {
    return;
  }
  const guildId = message.guildId;

  const result = await db.get<{ archive_channel_id: string; react_trigger: string }>(
    "SELECT archive_channel_id, react_trigger FROM config WHERE guild_id = ?",
    guildId,
  );
  if (result === undefined) {
    // Config entry not present in database.
    return;
  }

  if (message.partial) {
    await message.fetch();
  }

  const archiveChannel = await message.guild.channels.fetch(result.archive_channel_id);
  if (archiveChannel === null) {
    log.error("Unable to fetch archive channel %s for guild %s", result.archive_channel_id, guildId);
    return;
  }

  if (!archiveChannel.isText) {
    log.error("Archive channel initialized to non-text channel somehow in guild %s", guildId);
    return;
  }

  try {
    const embeds = formatEmbeds(message);
    await (archiveChannel as TextChannel).send({
      content: `Message from <@${message.author.id}>: ${message.url}`,
      embeds: embeds,
    });
  } catch (error) {
    log.error("Error sending to archive channel: %s", error);
    return;
  }

  // Add a reaction of our own to prevent re-pinning.
  await message.react(result.react_trigger);

  log.info("Archived message %s in guild %s", message.id, guildId);
};

const maybeUnpin = async (message: Message) => {
  const pinned = await message.channel.messages.fetchPinned();
  // Allow for some slack due to inherent TOCTTOU
  // TODO: retry
  if (pinned.size >= 49) {
    await pinned.last()?.unpin();
  }
};

const safePin = async (message: Message) => {
  log.info("Pinning message %s in guild", message.id, message.guildId);
  if (!message.pinnable) {
    return;
  }

  await maybeUnpin(message);
  await message.pin();
};

export const registerCommands = (client: Client, db: DB) => {
  const commands: Command[] = [
    {
      name: "ping",
      description: "Test the overall round-trip ping time to the bot.",
      async execute(interaction) {
        const delta = Date.now() - interaction.createdTimestamp;
        await interaction.reply(`:ping_pong: ${delta}`);
      },
    },
    {
      name: "getreactcount",
      description: "Check the current number of reactions required to pin a message.",
      async execute(interaction) {
        await getReactCountCommand(interaction, db);
      },
    },
    {
      ...new SlashCommandBuilder()
        .setName("init")
        .setDescription("Initialize the pin archiver channel")
        .addChannelOption((option) =>
          option
            .setName(OPTION_PIN_ARCHIVE_CHANNEL)
            .setDescription("Channel to store archive pins")
            .setRequired(true)
            // Why doesn't this typecheck without .valueOf()??
            .addChannelType(ChannelType.GuildText.valueOf()),
        ),
      async execute(interaction) {
        await initCommand(interaction, db);
      },
    },
    {
      ...new SlashCommandBuilder()
        .setName("setreactcount")
        .setDescription("Set the number of reactions required to pin a message.")
        .addIntegerOption((option) =>
          option
            .setName(OPTION_REACT_COUNT)
            .setDescription("Channel to store archive pins")
            .setRequired(true)
            .setMinValue(1),
        ),
      async execute(interaction) {
        await setReactCountCommand(interaction, db);
      },
    },
  ];
  for (const command of commands) {
    client.commands.set(command.name, command);
  }
};

export const registerEvents = (client: Client, db: DB) => {
  client.on("messageReactionAdd", async (partialReaction, _user) => {
    const guildId = partialReaction.message.guildId;
    if (guildId === null) {
      return;
    }

    let reaction: MessageReaction;
    if (partialReaction.partial) {
      // TOCTTOU: the message could be deleted by the time we fetch it.
      try {
        reaction = await partialReaction.fetch();
      } catch (error) {
        log.error("Something went wrong when fetching message id %s: %s", partialReaction.message.id, error);
        return;
      }
    } else {
      reaction = partialReaction;
    }

    // According to the guide, the message is now fully available. Unfortunately
    // the type system doesn't know about that.
    // https://discordjs.guide/popular-topics/reactions.html#listening-for-reactions-on-old-messages
    const message = reaction.message;
    if (message.partial) {
      log.warn("Partial message %s found despite fetching reaction", message.id);
      return;
    }

    try {
      const trigger = await getReactTrigger(db, guildId);
      log.debug("Trigger is %s, name is %s", trigger, reaction.emoji.name);
      if (reaction.emoji.name !== trigger) {
        return;
      }

      const reactionTriggerCount = (await getReactCount(db, guildId)) ?? NaN;
      log.debug("reactCount is %d, actual count is %d", reactionTriggerCount, reaction.count);
      if (reaction.count < reactionTriggerCount) {
        return;
      }
    } catch (error) {
      log.error("Error handling messageReactionAdd event: %s", error);
    }

    await safePin(message);
    // The other handler will do the archiving. Otherwise, we will get
    // duplicated pin archive messages.
  });

  client.on("messageCreate", async (message) => {
    if (!message.inGuild()) {
      return;
    }
    if (message.type !== "CHANNEL_PINNED_MESSAGE") {
      return;
    }
    const pinnedMessage = await message.fetchReference();
    await maybeUnpin(pinnedMessage);
    await archiveMessage(pinnedMessage, db);
  });
};
