/**
 * LabelBench central server.
 *
 * The server hosts the SPA, the template store and the asset store. It never
 * touches a printer: printing happens in the browser, over Web Bluetooth or
 * Web Serial, on whichever workstation the printer is plugged into.
 *
 * TLS is terminated by Caddy in front of this process (see `deploy/caddy`).
 * The app also serves the SPA itself so the bare systemd deployment works
 * without Caddy — in that case put it behind a TLS-terminating reverse proxy.
 */
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { authenticate, isAuthorized, rejectUnauthorized } from "./auth/index.js";
import { registerHealthRoute, registerTemplateRoutes } from "./routes/api.js";
import { AssetService } from "./services/assets.js";
import { TemplateService } from "./services/templates.js";

export async function buildServer() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    bodyLimit: 32 * 1024 * 1024,
  });

  app.decorate("config", config);
  app.decorate("db", openDb({ path: config.databasePath }));

  const templates = new TemplateService(app.db);
  const assets = new AssetService(app.db, config.assetDir);

  // Resolve the actor for every request. Phase 1: always anonymous.
  app.addHook("onRequest", async (request, reply) => {
    request.actor = authenticate(request, config).actor;

    // Phase 1 runs open on the trusted LAN, which is the locked decision.
    // But the seam has to actually gate when it is switched on: a config
    // flag that leaves the API wide open while looking like protection is
    // worse than no flag at all. Health stays open so a probe can check
    // liveness without a credential.
    if (
      config.authMode !== "none" &&
      request.url.startsWith("/api/") &&
      !request.url.startsWith("/api/health")
    ) {
      if (!isAuthorized(request, config)) {
        rejectUnauthorized(reply);
        return reply;
      }
    }
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxAssetBytes, files: 1 },
  });

  registerHealthRoute(app);
  registerTemplateRoutes(app, { templates, assets });

  // Serve the built SPA. Unknown paths fall through to index.html so the
  // client-side router owns navigation.
  if (existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: "/",
      index: ["index.html"],
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply
        .code(503)
        .send({ error: "spa_not_built", hint: "Build web/ and set LABELBENCH_STATIC_DIR" });
    });
  }

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  const { host, port } = app.config;

  await app.listen({ host, port });
  app.log.info(`LabelBench server listening on ${host}:${port}`);
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");

if (isMain || process.env.LABELBENCH_FORCE_START === "1") {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
