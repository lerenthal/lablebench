/**
 * §6 Backend API (minimal REST, JSON).
 *
 *   GET    /api/templates
 *   POST   /api/templates
 *   GET    /api/templates/:id
 *   PUT    /api/templates/:id
 *   DELETE /api/templates/:id
 *   POST   /api/assets
 *   GET    /api/assets/:id
 *   GET    /api/health
 *
 * Extras the brief calls for elsewhere:
 *   POST   /api/templates/:id/duplicate   (§5.3 duplication)
 *   GET    /api/templates/:id/versions    (§5.3 optional version history)
 *   POST   /api/templates/:id/versions/:versionId/restore
 *
 * §5.4 serial counters (the server owns the serial sequence):
 *   GET    /api/serial-counters
 *   POST   /api/serial-counters/:name/next
 *   POST   /api/serial-counters/:name/reset
 *
 * Phase 1: no auth. All routes are reachable without a login. The actor is
 * resolved once by the auth hook and read from `request.actor`.
 */
import type { FastifyInstance } from "fastify";
import { TemplateInputSchema } from "../domain/template.js";
import { SerialCounterNameSchema, SerialNextSchema, SerialResetSchema } from "../domain/serial.js";
import { listCounters, nextValue, resetValue, SerialValidationError } from "../services/serial.js";
import type { AssetService } from "../services/assets.js";
import type { TemplateService } from "../services/templates.js";

export type RouteDeps = {
  templates: TemplateService;
  assets: AssetService;
};

/**
 * The image types an asset may be stored and served as.
 *
 * An asset is served from the app's own origin, so a type the browser could
 * interpret as a document — HTML, or SVG with script in it — would be a way
 * to run script against the page that holds the API key and the printer's
 * device grants. Only the raster formats the designer can put on a label
 * are allowed.
 */
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
]);

/**
 * Whether an error is the multipart plugin refusing a file over the limit.
 *
 * The plugin enforces the size limit itself and throws before the route
 * can look at the bytes, so this is how the documented error shape is
 * returned instead of the plugin's own.
 */
const isFileTooLarge = (error: unknown, maxBytes: number): boolean => {
  if (typeof error !== "object" || error === null) return false;

  const code = (error as { code?: string }).code;
  if (code === "FST_REQ_FILE_TOO_LARGE") return true;

  const message = (error as { message?: string }).message;
  return typeof message === "string" && message.includes("request file too large");
};

export function registerTemplateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { templates, assets } = deps;

  app.get("/api/templates", async (request) => {
    return { templates: templates.list(request.actor) };
  });

  app.post("/api/templates", async (request, reply) => {
    const parsed = TemplateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_template", details: parsed.error.issues });
    }

    const template = templates.create(parsed.data, request.actor);
    return reply.code(201).send({ template });
  });

  app.get("/api/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const template = templates.get(id, request.actor);
    if (template === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    return { template };
  });

  app.put("/api/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const parsed = TemplateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_template", details: parsed.error.issues });
    }

    const template = templates.update(id, parsed.data, request.actor);
    if (template === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    return { template };
  });

  app.delete("/api/templates/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!templates.delete(id, request.actor)) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.code(204).send();
  });

  app.post("/api/templates/:id/duplicate", async (request, reply) => {
    const { id } = request.params as { id: string };

    const template = templates.duplicate(id, request.actor);
    if (template === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.code(201).send({ template });
  });

  app.get("/api/templates/:id/versions", async (request) => {
    const { id } = request.params as { id: string };

    return { versions: templates.listVersions(id, request.actor) };
  });

  app.post("/api/templates/:id/versions/:versionId/restore", async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };

    const template = templates.restoreVersion(id, versionId, request.actor);
    if (template === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    return { template };
  });

  app.get("/api/assets", async (request) => {
    return { assets: assets.list(request.actor) };
  });

  app.post("/api/assets", async (request, reply) => {
    const file = await request.file();
    if (file === undefined) {
      return reply.code(400).send({ error: "no_file" });
    }

    const maxBytes = app.config.maxAssetBytes;

    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch (e) {
      // The multipart plugin enforces the limit itself, so it throws before
      // the size can be checked here. The shape the API documents is the
      // shape the client actually gets.
      if (isFileTooLarge(e, maxBytes)) {
        return reply.code(413).send({ error: "too_large", max_bytes: maxBytes });
      }

      throw e;
    }

    if (bytes.length > maxBytes) {
      return reply.code(413).send({ error: "too_large", max_bytes: maxBytes });
    }

    const mime = file.mimetype || "application/octet-stream";

    // Only images are stored. An asset is served from the app's own origin,
    // so one that could be interpreted as a document — HTML, SVG — would be
    // a way to run script against the page that holds the API key and the
    // printer's device grants.
    if (!INLINE_IMAGE_TYPES.has(mime)) {
      return reply.code(415).send({ error: "unsupported_type", mime });
    }

    const asset = assets.save({ filename: file.filename, mime, bytes }, request.actor);

    return reply.code(201).send({ asset });
  });

  app.get("/api/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const asset = assets.get(id, request.actor);
    if (asset === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    // An asset that was stored before the allow-list existed is still served,
    // but not as a document: it is a download, and the browser is told not
    // to guess what it is.
    const inline = INLINE_IMAGE_TYPES.has(asset.mime);

    return reply
      .header("Content-Type", inline ? asset.mime : "application/octet-stream")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", inline ? "inline" : "attachment")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .send(assets.read(asset));
  });
}

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/api/health", async () => {
    // Touch the database so a broken volume shows up here rather than on first write.
    app.db.prepare("SELECT 1").get();

    return {
      status: "ok",
      service: "labelbench-server",
      version: 1,
      time: new Date().toISOString(),
    };
  });
}

/**
 * §5.4 serial counters. The server owns the sequence so a number is never
 * handed out twice, no matter which workstation asks for it.
 */
export function registerSerialRoutes(app: FastifyInstance): void {
  app.get("/api/serial-counters", async () => {
    return { counters: listCounters(app.db) };
  });

  app.post("/api/serial-counters/:name/next", async (request, reply) => {
    const { name } = request.params as { name: string };

    const parsedName = SerialCounterNameSchema.safeParse(name);
    if (!parsedName.success) {
      return reply.code(400).send({ error: "invalid_counter", details: parsedName.error.issues });
    }

    const parsed = SerialNextSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_counter", details: parsed.error.issues });
    }

    try {
      const counter = nextValue(app.db, parsedName.data, parsed.data);
      return { name: counter.name, value: counter.value, updated_at: counter.updated_at };
    } catch (error) {
      if (error instanceof SerialValidationError) {
        return reply.code(400).send({ error: "invalid_counter", details: error.issues });
      }
      throw error;
    }
  });

  app.post("/api/serial-counters/:name/reset", async (request, reply) => {
    const { name } = request.params as { name: string };

    const parsedName = SerialCounterNameSchema.safeParse(name);
    if (!parsedName.success) {
      return reply.code(400).send({ error: "invalid_counter", details: parsedName.error.issues });
    }

    const parsed = SerialResetSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_counter", details: parsed.error.issues });
    }

    try {
      const counter = resetValue(app.db, parsedName.data, parsed.data.value ?? 0);
      return { name: counter.name, value: counter.value, updated_at: counter.updated_at };
    } catch (error) {
      if (error instanceof SerialValidationError) {
        return reply.code(400).send({ error: "invalid_counter", details: error.issues });
      }
      throw error;
    }
  });
}
