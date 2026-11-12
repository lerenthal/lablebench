import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildServer } from "../server.js";
import { openDb } from "../db/index.js";
import { nextValue } from "../services/serial.js";

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

describe("serial counters", () => {
  it("returns 1 on the first allocation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/serial-counters/labels/next",
      payload: {},
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.name, "labels");
    assert.equal(body.value, 1);
    assert.ok(body.updated_at);
  });

  it("honours start and step", async () => {
    const opts = { start: 100, step: 5 };

    const first = await app.inject({
      method: "POST",
      url: "/api/serial-counters/lot-42/next",
      payload: opts,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().value, 100);

    const second = await app.inject({
      method: "POST",
      url: "/api/serial-counters/lot-42/next",
      payload: opts,
    });
    assert.equal(second.json().value, 105);

    const third = await app.inject({
      method: "POST",
      url: "/api/serial-counters/lot-42/next",
      payload: opts,
    });
    assert.equal(third.json().value, 110);
  });

  it("never hands out the same number twice", async () => {
    const seen = new Set<number>();

    for (let i = 0; i < 25; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/serial-counters/unique/next",
        payload: {},
      });

      assert.equal(res.statusCode, 200);
      const value = res.json().value as number;
      assert.equal(seen.has(value), false);
      seen.add(value);
    }

    assert.equal(seen.size, 25);
  });

  it("resets a counter and continues from there", async () => {
    await app.inject({
      method: "POST",
      url: "/api/serial-counters/resettable/next",
      payload: { start: 10, step: 2 },
    });

    const reset = await app.inject({
      method: "POST",
      url: "/api/serial-counters/resettable/reset",
      payload: { value: 500 },
    });

    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().value, 500);

    // The stored value is the last number handed out, so the next allocation
    // continues from the reset point.
    const next = await app.inject({
      method: "POST",
      url: "/api/serial-counters/resettable/next",
      payload: { step: 2 },
    });

    assert.equal(next.json().value, 502);
  });

  it("resets to 0 when no value is given", async () => {
    const reset = await app.inject({
      method: "POST",
      url: "/api/serial-counters/zeroed/reset",
      payload: {},
    });

    assert.equal(reset.statusCode, 200);
    assert.equal(reset.json().value, 0);

    const next = await app.inject({
      method: "POST",
      url: "/api/serial-counters/zeroed/next",
      payload: {},
    });

    assert.equal(next.json().value, 1);
  });

  it("lists the counters", async () => {
    const res = await app.inject({ method: "GET", url: "/api/serial-counters" });

    assert.equal(res.statusCode, 200);
    const counters = res.json().counters as Array<{ name: string; value: number }>;
    const labels = counters.find((counter) => counter.name === "labels");

    assert.ok(labels);
    assert.equal(labels.value, 1);
  });

  it("keeps the counter across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "labelbench-serial-"));
    const path = join(dir, "serial.db");

    try {
      const first = openDb({ path });
      const allocated = nextValue(first, "durable");
      assert.equal(allocated.value, 1);
      first.close();

      // Reopen the same file: the counter must not restart.
      const second = openDb({ path });
      const resumed = nextValue(second, "durable");
      assert.equal(resumed.value, 2);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid counter name", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/serial-counters//next",
      payload: {},
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().error, "invalid_counter");

    const tooLong = await app.inject({
      method: "POST",
      url: `/api/serial-counters/${"x".repeat(129)}/next`,
      payload: {},
    });
    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().error, "invalid_counter");

    const controlChar = await app.inject({
      method: "POST",
      url: "/api/serial-counters/bad%00name/next",
      payload: {},
    });
    assert.equal(controlChar.statusCode, 400);
    assert.equal(controlChar.json().error, "invalid_counter");

    // The service rejects a bad name too, so a caller that skips the route
    // cannot slip an invalid name into the database.
    assert.throws(
      () => nextValue(app.db, ""),
      /Invalid serial counter name/,
    );
    assert.throws(
      () => nextValue(app.db, "x".repeat(129)),
      /Invalid serial counter name/,
    );
    assert.throws(
      () => nextValue(app.db, "bad\u0000name"),
      /Invalid serial counter name/,
    );
  });

  it("rejects an invalid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/serial-counters/labels/next",
      payload: { step: 1.5 },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_counter");
  });
});

describe("the API key gate", () => {
  let gatedApp: Awaited<ReturnType<typeof buildServer>>;
  let gatedDir: string;

  before(async () => {
    gatedDir = mkdtempSync(join(tmpdir(), "labelbench-auth-"));
    process.env.LABELBENCH_DATA_DIR = gatedDir;
    process.env.LABELBENCH_STATIC_DIR = join(gatedDir, "no-spa");
    process.env.LABELBENCH_AUTH_MODE = "apikey";
    process.env.LABELBENCH_API_KEY = "test-key";
    gatedApp = await buildServer();
    await gatedApp.ready();
  });

  after(async () => {
    await gatedApp.close();
    rmSync(gatedDir, { recursive: true, force: true });
    delete process.env.LABELBENCH_AUTH_MODE;
    delete process.env.LABELBENCH_API_KEY;
  });

  it("rejects a request with no key", async () => {
    const res = await gatedApp.inject({ method: "GET", url: "/api/templates" });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, "unauthorized");
  });

  it("rejects a request with the wrong key", async () => {
    const res = await gatedApp.inject({
      method: "GET",
      url: "/api/templates",
      headers: { "x-api-key": "wrong" },
    });
    assert.equal(res.statusCode, 401);
  });

  it("accepts a request with the right key", async () => {
    const res = await gatedApp.inject({
      method: "GET",
      url: "/api/templates",
      headers: { "x-api-key": "test-key" },
    });
    assert.equal(res.statusCode, 200);
  });

  it("blocks writes without the key", async () => {
    const res = await gatedApp.inject({
      method: "POST",
      url: "/api/templates",
      payload: templatePayload,
    });
    assert.equal(res.statusCode, 401);
  });

  it("allows writes with the key", async () => {
    const res = await gatedApp.inject({
      method: "POST",
      url: "/api/templates",
      headers: { "x-api-key": "test-key" },
      payload: templatePayload,
    });
    assert.equal(res.statusCode, 201);
  });

  it("leaves health open, so a probe needs no credential", async () => {
    const res = await gatedApp.inject({ method: "GET", url: "/api/health" });
    assert.equal(res.statusCode, 200);
  });

  it("does not gate the SPA shell", async () => {
    // The static dir does not exist in the test, so the shell answers 503 --
    // what matters is that it is not 401.
    const res = await gatedApp.inject({ method: "GET", url: "/" });
    assert.notEqual(res.statusCode, 401);
  });
});
