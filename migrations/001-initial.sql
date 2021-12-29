CREATE TABLE config (
    guild_id TEXT PRIMARY KEY,
    archive_channel_id TEXT NOT NULL,
    react_count INTEGER NOT NULL DEFAULT 9,
    react_trigger TEXT NOT NULL DEFAULT '📌'
);
