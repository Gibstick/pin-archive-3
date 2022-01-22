/**
 * Basic bot client setup.
 */
import bunyan from "bunyan";
import { Client, Collection, Intents } from "discord.js";

const CreateBot = (): Client => {
  const log = bunyan.createLogger({ name: "create-bot" });

  const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
    partials: ["MESSAGE", "REACTION", "CHANNEL"],
  });
  client.commands = new Collection();

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand()) return;

    if (!client.commands.has(interaction.commandName)) return;

    try {
      const command = client.commands.get(interaction.commandName);
      command?.execute(interaction);
    } catch (error) {
      log.error({ err: error, msg: "error excecuting command", command: interaction.commandName });
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  });

  // TODO: smarter deploy
  client.once("ready", async () => {
    log.info("ready!");
    for (const guild of client.guilds.cache.values()) {
      for (const command of client.commands.values()) {
        await guild.commands.create(command);
        log.info({ guildId: guild.id }, "command created: %s", command.name);
      }
    }
  });

  return client;
};

export default CreateBot;
