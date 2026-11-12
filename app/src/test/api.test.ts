import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildServer } from "../server.js";

let app: Awaited<ReturnType<typeof buildServer>>;
let dataDir: string;

const templatePayload = {
  name: "Tube label",
  model: "d11",
  label_w_mm: 12,
  label_h_mm: 20,
  orientation: "left",
  canvas: {
    fabric: { version: "6.0.0", objects: [] },
    label: { printDirection: "left", size: { width: 96, height: 160 } },
    dpmm: 8,
    thumbnail: "data:image/png;base64,AAAA",
  },
  variables: {
    variables: [{ name: "lot", type: "text", required: true }],
    csv_mapping: { lot: "lot_code" },
  },
  asset_ids: [],
  tags: ["lab"],
};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "labelbench-test-"));
  process.env.LABELBENCH_DATA_DIR = dataDir;
  process.env.LABELBENCH_STATIC_DIR = join(dataDir, "no-spa");
  app = await buildServer();
  await app.ready();
});

after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("health", () => {
  it("reports ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().status, "ok");
  });
});

describe("templates CRUD", () => {
  let createdId: string;

  it("creates a template", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/templates",
      payload: templatePayload,
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    createdId = body.template.id;
    assert.equal(body.template.name, "Tube label");
    assert.equal(body.template.model, "d11");
    assert.equal(body.template.label_w_mm, 12);
    assert.equal(body.template.variables.csv_mapping.lot, "lot_code");
    assert.ok(createdId);
  });

  it("rejects an invalid template", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/templates",
      payload: { ...templatePayload, model: "nope" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("lists templates with summaries", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates" });
    assert.equal(res.statusCode, 200);

    const list = res.json().templates as Array<Record<string, unknown>>;
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.variable_names, ["lot"]);
    assert.deepEqual(list[0]!.tags, ["lab"]);
    // The gallery needs the label geometry to render the card.
    assert.deepEqual(list[0]!.label, {
      printDirection: "left",
      size: { width: 96, height: 160 },
    });
    // The heavy canvas document must not be in the list payload.
    assert.equal(list[0]!.canvas, undefined);
  });

  it("gets a template by id", async () => {
    const res = await app.inject({ method: "GET", url: `/api/templates/${createdId}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().template.canvas.label.size.width, 96);
  });

  it("returns 404 for an unknown template", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates/does-not-exist" });
    assert.equal(res.statusCode, 404);
  });

  it("updates a template", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/templates/${createdId}`,
      payload: { ...templatePayload, name: "Tube label v2", model: "b21" },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().template.name, "Tube label v2");
    assert.equal(res.json().template.model, "b21");
  });

  it("snapshots the previous revision into version history", async () => {
    const res = await app.inject({ method: "GET", url: `/api/templates/${createdId}/versions` });
    assert.equal(res.statusCode, 200);

    const versions = res.json().versions as Array<{ version: number }>;
    assert.equal(versions.length, 1);
    assert.equal(versions[0]!.version, 1);
  });

  it("restores a previous version", async () => {
    const versionsRes = await app.inject({
      method: "GET",
      url: `/api/templates/${createdId}/versions`,
    });
    const versionId = (versionsRes.json().versions as Array<{ id: string }>)[0]!.id;

    const res = await app.inject({
      method: "POST",
      url: `/api/templates/${createdId}/versions/${versionId}/restore`,
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().template.name, "Tube label");
    assert.equal(res.json().template.model, "d11");
  });

  it("duplicates a template", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/templates/${createdId}/duplicate`,
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.json().template.name, "Tube label (copy)");

    const listRes = await app.inject({ method: "GET", url: "/api/templates" });
    assert.equal((listRes.json().templates as unknown[]).length, 2);
  });

  it("deletes a template", async () => {
    const listRes = await app.inject({ method: "GET", url: "/api/templates" });
    const id = (listRes.json().templates as Array<{ id: string }>)[0]!.id;

    const res = await app.inject({ method: "DELETE", url: `/api/templates/${id}` });
    assert.equal(res.statusCode, 204);

    const afterRes = await app.inject({ method: "GET", url: `/api/templates/${id}` });
    assert.equal(afterRes.statusCode, 404);
  });
});

describe("assets", () => {
  let assetId: string;

  it("uploads an asset", async () => {
    const payload = Buffer.from("\x89PNG\r\n\x1a\nfake-image-bytes");
    const res = await app.inject({
      method: "POST",
      url: "/api/assets",
      headers: {
        "content-type": "multipart/form-data; boundary=----lbtest",
      },
      payload: Buffer.concat([
        Buffer.from("------lbtest\r\n"),
        Buffer.from('Content-Disposition: form-data; name="file"; filename="dot.png"\r\n'),
        Buffer.from("Content-Type: image/png\r\n\r\n"),
        payload,
        Buffer.from("\r\n------lbtest--\r\n"),
      ]),
    });

    assert.equal(res.statusCode, 201);
    assetId = res.json().asset.id;
    assert.equal(res.json().asset.mime, "image/png");
    assert.equal(res.json().asset.kind, "image");
  });

  it("serves the asset bytes back", async () => {
    const res = await app.inject({ method: "GET", url: `/api/assets/${assetId}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
  });

  it("404s on an unknown asset", async () => {
    const res = await app.inject({ method: "GET", url: "/api/assets/nope" });
    assert.equal(res.statusCode, 404);
  });
});
