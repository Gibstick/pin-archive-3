import bunyan from "bunyan";
import dotenv from "dotenv";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import CreateBot from "./bot";
import { env } from "./env";
import * as PinArchive from "./pin-archive";

// Top-level await + typescript is not worth the pain
// https://stackoverflow.com/a/65257652/6549266
(async () => {
  dotenv.config();
  const log = bunyan.createLogger({ name: "main" });

  const bot = CreateBot();
  const db = await open({
    filename: env("PIN_ARCHIVE_DB"),
    driver: sqlite3.cached.Database,
  });

  await db.migrate();
  db.run("PRAGMA foreign_keys = ON");

  PinArchive.registerCommands(bot, db);
  PinArchive.registerEvents(bot, db);

  bot.login(env("PIN_ARCHIVE_BOT_TOKEN"));
})();
