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
 * Phase 1: no auth. All routes are reachable without a login. The actor is
 * resolved once by the auth hook and read from `request.actor`.
 */
import type { FastifyInstance } from "fastify";
import { TemplateInputSchema } from "../domain/template.js";
import type { AssetService } from "../services/assets.js";
import type { TemplateService } from "../services/templates.js";

export type RouteDeps = {
  templates: TemplateService;
  assets: AssetService;
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

    const bytes = await file.toBuffer();
    const maxBytes = app.config.maxAssetBytes;

    if (bytes.length > maxBytes) {
      return reply.code(413).send({ error: "too_large", max_bytes: maxBytes });
    }

    const mime = file.mimetype || "application/octet-stream";
    const asset = assets.save({ filename: file.filename, mime, bytes }, request.actor);

    return reply.code(201).send({ asset });
  });

  app.get("/api/assets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const asset = assets.get(id, request.actor);
    if (asset === undefined) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply
      .header("Content-Type", asset.mime)
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
