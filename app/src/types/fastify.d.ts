import "fastify";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { Actor } from "../services/templates.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }

  interface FastifyRequest {
    /** Resolved by the auth hook in `src/server.ts`. */
    actor: Actor;
  }
}
