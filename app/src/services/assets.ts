/**
 * Asset service — uploaded images and fonts.
 *
 * §5.3: a template "stores ... references to any uploaded assets". Assets live on
 * the server so every workstation renders the same label, and so a 40 MB font
 * is not copied into every browser's localStorage.
 *
 * §8: "The SQLite file + asset dir together are the entire backup."
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/index.js";
import { resolveInside } from "../db/index.js";
import type { Actor } from "./templates.js";

export type AssetKind = "image" | "font" | "other";

export type Asset = {
  id: string;
  filename: string;
  mime: string;
  path: string;
  size_bytes: number;
  kind: AssetKind;
  created_at: string;
};

type AssetRow = {
  id: string;
  filename: string;
  mime: string;
  path: string;
  size_bytes: number;
  kind: string;
  created_at: string;
};

const IMAGE_MIME_PREFIX = "image/";
const FONT_MIME_PREFIX = "font/";

export class AssetService {
  constructor(
    private readonly db: Db,
    private readonly assetDir: string,
  ) {
    mkdirSync(assetDir, { recursive: true });
  }

  list(actor: Actor): Asset[] {
    void actor;
    const rows = this.db.prepare("SELECT * FROM asset ORDER BY created_at DESC").all() as AssetRow[];
    return rows.map(toAsset);
  }

  get(id: string, actor: Actor): Asset | undefined {
    void actor;
    const row = this.db.prepare("SELECT * FROM asset WHERE id = ?").get(id) as AssetRow | undefined;
    return row === undefined ? undefined : toAsset(row);
  }

  /** Absolute path of an asset's bytes on disk. */
  absolutePath(asset: Asset): string {
    return resolveInside(this.assetDir, asset.path);
  }

  read(asset: Asset): Buffer {
    return readFileSync(this.absolutePath(asset));
  }

  /**
   * Store an uploaded asset. Content-addressed by SHA-256 of the bytes so the
   * same image uploaded twice does not consume the disk twice.
   */
  save(
    input: { filename: string; mime: string; bytes: Buffer },
    actor: Actor,
  ): Asset {
    void actor;

    const digest = createHash("sha256").update(input.bytes).digest("hex");
    const existing = this.db
      .prepare("SELECT * FROM asset WHERE path = ?")
      .get(`${digest}.bin`) as AssetRow | undefined;

    if (existing !== undefined) {
      return toAsset(existing);
    }

    const id = randomUUID();
    const relativePath = `${digest}.bin`;
    const absolute = resolveInside(this.assetDir, relativePath);

    writeFileSync(absolute, input.bytes);

    const kind: AssetKind = input.mime.startsWith(IMAGE_MIME_PREFIX)
      ? "image"
      : input.mime.startsWith(FONT_MIME_PREFIX)
        ? "font"
        : "other";

    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO asset (id, filename, mime, path, size_bytes, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.filename, input.mime, relativePath, input.bytes.length, kind, createdAt);

    const asset: Asset = {
      id,
      filename: input.filename,
      mime: input.mime,
      path: relativePath,
      size_bytes: input.bytes.length,
      kind,
      created_at: createdAt,
    };

    // Touch the file so a stale row (file deleted by hand) is detectable.
    statSync(absolute);

    return asset;
  }

  delete(id: string, actor: Actor): boolean {
    void actor;
    const asset = this.get(id, actor);
    if (asset === undefined) {
      return false;
    }
    const result = this.db.prepare("DELETE FROM asset WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Directory layout helper used by the container volume mount. */
  get directory(): string {
    return this.assetDir;
  }

  /** Path of an asset relative to the asset root, for URLs. */
  relativeUrl(asset: Asset): string {
    return join("assets", asset.path);
  }
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    path: row.path,
    size_bytes: row.size_bytes,
    kind: row.kind as AssetKind,
    created_at: row.created_at,
  };
}
