/**
 * LabelBench SQLite schema.
 *
 * Migrations are append-only. Each entry is applied once, in order, and
 * recorded in `schema_migrations`. Never edit a shipped migration — add a new one.
 */
import type { Database } from "better-sqlite3";

export type Migration = {
  id: string;
  up: (db: Database) => void;
};

export const migrations: Migration[] = [
  {
    id: "001_core",
    up: (db) => {
      db.exec(`
        -- §7 Data model: templates.
        -- canvas_json holds the render input: { fabric: <FabricJson>, label: <LabelProps> }.
        -- Keeping the Fabric object graph and the label geometry in one document
        -- keeps the template a self-contained render unit (see §9: a later
        -- server-side render path consumes exactly this document).
        CREATE TABLE template (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          model         TEXT NOT NULL,          -- d11 | b21
          label_w_mm    REAL NOT NULL,
          label_h_mm    REAL NOT NULL,
          orientation   TEXT NOT NULL,          -- left | top  (90° print rotation)
          canvas_json   TEXT NOT NULL,
          variables_json TEXT NOT NULL,         -- declared variables + CSV column bindings
          asset_ids     TEXT NOT NULL DEFAULT '[]',
          tags          TEXT NOT NULL DEFAULT '[]',
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL
        );

        CREATE INDEX idx_template_updated_at ON template (updated_at DESC);
        CREATE INDEX idx_template_name       ON template (name COLLATE NOCASE);

        -- §5.3 / §6: uploaded images and fonts live on the server, not in the
        -- browser and not inlined in the template document.
        CREATE TABLE asset (
          id          TEXT PRIMARY KEY,
          filename    TEXT NOT NULL,
          mime        TEXT NOT NULL,
          path        TEXT NOT NULL,            -- relative to the asset root
          size_bytes  INTEGER NOT NULL,
          kind        TEXT NOT NULL DEFAULT 'image',  -- image | font
          created_at  TEXT NOT NULL
        );

        -- §5.3: optional version history. A snapshot of the whole template
        -- (not just the canvas) so a restore returns a coherent template —
        -- restoring a d11 canvas onto a b21 template would otherwise leave
        -- the record inconsistent.
        CREATE TABLE template_version (
          id            TEXT PRIMARY KEY,
          template_id   TEXT NOT NULL REFERENCES template (id) ON DELETE CASCADE,
          version       INTEGER NOT NULL,
          name          TEXT NOT NULL,
          model         TEXT NOT NULL,
          label_w_mm    REAL NOT NULL,
          label_h_mm    REAL NOT NULL,
          orientation   TEXT NOT NULL,
          canvas_json   TEXT NOT NULL,
          variables_json TEXT NOT NULL,
          asset_ids     TEXT NOT NULL DEFAULT '[]',
          tags          TEXT NOT NULL DEFAULT '[]',
          created_at    TEXT NOT NULL,
          UNIQUE (template_id, version)
        );

        CREATE INDEX idx_template_version_tpl ON template_version (template_id, version DESC);

        -- §7: reserved for a later phase. Phase 1 runs with auth off, but the
        -- tables exist so adding a gate later does not require a schema rewrite.
        CREATE TABLE app_user (
          id           TEXT PRIMARY KEY,
          name         TEXT NOT NULL,
          api_key_hash TEXT,
          created_at   TEXT NOT NULL
        );

        CREATE TABLE api_key (
          id          TEXT PRIMARY KEY,
          token_hash  TEXT NOT NULL UNIQUE,
          label       TEXT,
          created_at  TEXT NOT NULL,
          revoked_at  TEXT
        );
      `);
    },
  },
];
