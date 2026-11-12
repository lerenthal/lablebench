/**
 * Configuration, resolved from the environment.
 *
 * Every path is resolved once at startup so the rest of the code never
 * has to think about where the data lives.
 */
import { resolve } from "node:path";

export type Config = {
  host: string;
  port: number;
  /** SQLite file. Together with the asset directory this is the entire backup. */
  databasePath: string;
  /** Directory holding uploaded images and fonts. */
  assetDir: string;
  /** Static SPA bundle. Served by the app when Caddy is not in front of it. */
  staticDir: string;
  /** Phase 1 runs open on the LAN. Kept as a seam for a later gate. */
  authMode: "none" | "apikey";
  /** Shared secret for authMode=apikey. Unused in Phase 1. */
  apiKey: string | undefined;
  /** Max upload size for assets, bytes. */
  maxAssetBytes: number;
};

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): Config {
  const dataDir = resolve(envString("LABELBENCH_DATA_DIR", "./data"));

  return {
    host: envString("LABELBENCH_HOST", "0.0.0.0"),
    port: envNumber("LABELBENCH_PORT", 3000),
    databasePath: resolve(envString("LABELBENCH_DB_PATH", `${dataDir}/labelbench.db`)),
    assetDir: resolve(envString("LABELBENCH_ASSET_DIR", `${dataDir}/assets`)),
    staticDir: resolve(envString("LABELBENCH_STATIC_DIR", "./web/dist")),
    authMode: envString("LABELBENCH_AUTH_MODE", "none") === "apikey" ? "apikey" : "none",
    apiKey: process.env.LABELBENCH_API_KEY,
    maxAssetBytes: envNumber("LABELBENCH_MAX_ASSET_BYTES", 25 * 1024 * 1024),
  };
}
