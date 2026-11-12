/**
 * Template service layer.
 *
 * §6: "Keep all data access behind a thin service layer so a shared-password or
 * API-key gate can be added later without reworking the API or editor."
 *
 * Every route goes through this module and nothing else touches SQL for templates.
 * The `actor` parameter is the seam where a future auth gate plugs in.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../db/index.js";
import {
  CanvasDocumentSchema,
  TemplateVariablesSchema,
  type CanvasDocument,
  type Template,
  type TemplateInput,
  type TemplateSummary,
  type TemplateVariables,
  type TemplateVersion,
} from "../domain/template.js";

export type Actor = {
  /** Present only once auth is enabled. */
  subject?: string;
};

type TemplateRow = {
  id: string;
  name: string;
  model: string;
  label_w_mm: number;
  label_h_mm: number;
  orientation: string;
  canvas_json: string;
  variables_json: string;
  asset_ids: string;
  tags: string;
  created_at: string;
  updated_at: string;
};

type TemplateVersionRow = TemplateRow & {
  template_id: string;
  version: number;
};

export class TemplateService {
  constructor(private readonly db: Db) {}

  list(actor: Actor): TemplateSummary[] {
    void actor;
    const rows = this.db
      .prepare("SELECT * FROM template ORDER BY updated_at DESC")
      .all() as TemplateRow[];

    return rows.map((row) => this.toSummary(row));
  }

  get(id: string, actor: Actor): Template | undefined {
    void actor;
    const row = this.db.prepare("SELECT * FROM template WHERE id = ?").get(id) as TemplateRow | undefined;
    return row === undefined ? undefined : this.toTemplate(row);
  }

  create(input: TemplateInput, actor: Actor): Template {
    void actor;
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO template
           (id, name, model, label_w_mm, label_h_mm, orientation, canvas_json, variables_json, asset_ids, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.model,
        input.label_w_mm,
        input.label_h_mm,
        input.orientation,
        JSON.stringify(input.canvas),
        JSON.stringify(input.variables ?? { variables: [], csv_mapping: {} }),
        JSON.stringify(input.asset_ids),
        JSON.stringify(input.tags),
        now,
        now,
      );

    const created = this.get(id, actor);
    if (created === undefined) {
      throw new Error("Template vanished immediately after creation");
    }
    return created;
  }

  /**
   * Replace a template. The previous canvas is snapshotted into
   * `template_version` first, so a bad edit is always recoverable.
   */
  update(id: string, input: TemplateInput, actor: Actor): Template | undefined {
    void actor;

    const existing = this.db.prepare("SELECT * FROM template WHERE id = ?").get(id) as
      | TemplateRow
      | undefined;

    if (existing === undefined) {
      return undefined;
    }

    this.snapshot(id, existing);

    this.db
      .prepare(
        `UPDATE template
            SET name = ?, model = ?, label_w_mm = ?, label_h_mm = ?, orientation = ?,
                canvas_json = ?, variables_json = ?, asset_ids = ?, tags = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        input.name,
        input.model,
        input.label_w_mm,
        input.label_h_mm,
        input.orientation,
        JSON.stringify(input.canvas),
        JSON.stringify(input.variables ?? { variables: [], csv_mapping: {} }),
        JSON.stringify(input.asset_ids),
        JSON.stringify(input.tags),
        new Date().toISOString(),
        id,
      );

    return this.get(id, actor);
  }

  delete(id: string, actor: Actor): boolean {
    void actor;
    const result = this.db.prepare("DELETE FROM template WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** §5.3: template duplication. */
  duplicate(id: string, actor: Actor): Template | undefined {
    const source = this.get(id, actor);
    if (source === undefined) {
      return undefined;
    }

    return this.create(
      {
        name: `${source.name} (copy)`,
        model: source.model,
        label_w_mm: source.label_w_mm,
        label_h_mm: source.label_h_mm,
        orientation: source.orientation,
        canvas: source.canvas,
        variables: source.variables,
        asset_ids: source.asset_ids,
        tags: source.tags,
      },
      actor,
    );
  }

  /** §5.3: optional version history. */
  listVersions(id: string, actor: Actor): TemplateVersion[] {
    void actor;
    const rows = this.db
      .prepare(
        "SELECT id, template_id, version, created_at FROM template_version WHERE template_id = ? ORDER BY version DESC",
      )
      .all(id) as TemplateVersion[];

    return rows;
  }

  getVersion(templateId: string, versionId: string, actor: Actor): TemplateVersion | undefined {
    void actor;
    const row = this.db
      .prepare(
        "SELECT id, template_id, version, created_at FROM template_version WHERE id = ? AND template_id = ?",
      )
      .get(versionId, templateId) as TemplateVersion | undefined;

    return row;
  }

  /** Restore a stored version over the template's current state. */
  restoreVersion(templateId: string, versionId: string, actor: Actor): Template | undefined {
    void actor;
    const snapshot = this.db
      .prepare("SELECT * FROM template_version WHERE id = ? AND template_id = ?")
      .get(versionId, templateId) as TemplateVersionRow | undefined;

    if (snapshot === undefined) {
      return undefined;
    }

    const existing = this.db.prepare("SELECT * FROM template WHERE id = ?").get(templateId) as
      | TemplateRow
      | undefined;

    if (existing === undefined) {
      return undefined;
    }

    this.snapshot(templateId, existing);

    this.db
      .prepare(
        `UPDATE template
            SET name = ?, model = ?, label_w_mm = ?, label_h_mm = ?, orientation = ?,
                canvas_json = ?, variables_json = ?, asset_ids = ?, tags = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        snapshot.name,
        snapshot.model,
        snapshot.label_w_mm,
        snapshot.label_h_mm,
        snapshot.orientation,
        snapshot.canvas_json,
        snapshot.variables_json,
        snapshot.asset_ids,
        snapshot.tags,
        new Date().toISOString(),
        templateId,
      );

    return this.get(templateId, actor);
  }

  private snapshot(templateId: string, row: TemplateRow): void {
    const next = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM template_version WHERE template_id = ?")
      .get(templateId) as { v: number };

    this.db
      .prepare(
        `INSERT INTO template_version
           (id, template_id, version, name, model, label_w_mm, label_h_mm, orientation,
            canvas_json, variables_json, asset_ids, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        templateId,
        next.v,
        row.name,
        row.model,
        row.label_w_mm,
        row.label_h_mm,
        row.orientation,
        row.canvas_json,
        row.variables_json,
        row.asset_ids,
        row.tags,
        new Date().toISOString(),
      );
  }

  private toTemplate(row: TemplateRow): Template {
    return {
      id: row.id,
      name: row.name,
      model: row.model as Template["model"],
      label_w_mm: row.label_w_mm,
      label_h_mm: row.label_h_mm,
      orientation: row.orientation as Template["orientation"],
      canvas: CanvasDocumentSchema.parse(JSON.parse(row.canvas_json)),
      variables: TemplateVariablesSchema.parse(JSON.parse(row.variables_json)),
      asset_ids: safeParseArray(row.asset_ids),
      tags: safeParseArray(row.tags),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toSummary(row: TemplateRow): TemplateSummary {
    const canvas = CanvasDocumentSchema.parse(JSON.parse(row.canvas_json)) as CanvasDocument;
    const variables = TemplateVariablesSchema.parse(JSON.parse(row.variables_json)) as TemplateVariables;

    return {
      id: row.id,
      name: row.name,
      model: row.model as TemplateSummary["model"],
      label_w_mm: row.label_w_mm,
      label_h_mm: row.label_h_mm,
      orientation: row.orientation as TemplateSummary["orientation"],
      tags: safeParseArray(row.tags),
      thumbnail: canvas.thumbnail,
      variable_names: variables.variables.map((v) => v.name),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

function safeParseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
