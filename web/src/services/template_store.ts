/**
 * Central template store.
 *
 * Replaces the browser-local template storage of upstream niimblue with the
 * central server store (§5.3, M1). Every workstation reads and writes the same
 * templates; nothing is kept in localStorage.
 *
 * Upstream keeps a `ExportedLabelTemplate` in memory. That shape is preserved
 * here so the rest of the fork barely changes — this module is the translation
 * layer between niimblue's document model and the server's column model (§7).
 */

import { api, type TemplatePayload } from "$/services/api";
import type {
  ExportedLabelTemplate,
  ServerTemplate,
  TemplateSummary,
} from "$/types";

/** Default dots per millimetre (203 dpi ≈ 8 px/mm). */
export const DEFAULT_DPMM = 8;

export function pxToMm(px: number, dpmm: number = DEFAULT_DPMM): number {
  return Math.round((px / dpmm) * 100) / 100;
}

export function mmToPx(mm: number, dpmm: number = DEFAULT_DPMM): number {
  return Math.round(mm * dpmm);
}

/**
 * Build the server payload from an in-memory template.
 *
 * `canvas.label.size` stays in pixels — it is the exact geometry the renderer
 * uses. The millimetre columns are the human-facing size and are derived from it,
 * so the two can never drift apart.
 */
export function toPayload(template: ExportedLabelTemplate): TemplatePayload {
  const dpmm = template.dpmm ?? DEFAULT_DPMM;

  return {
    name: template.title ?? "Untitled",
    model: template.model ?? "d11",
    label_w_mm: pxToMm(template.label.size.width, dpmm),
    label_h_mm: pxToMm(template.label.size.height, dpmm),
    orientation: template.label.printDirection,
    canvas: {
      fabric: template.canvas,
      label: template.label,
      dpmm,
      thumbnail: template.thumbnailBase64,
    },
    variables: template.variables,
    asset_ids: template.assetIds ?? [],
    tags: template.tags ?? [],
  };
}

/** Convert a server template back into niimblue's in-memory shape. */
export function fromServerTemplate(template: ServerTemplate): ExportedLabelTemplate {
  return {
    id: template.id,
    title: template.name,
    canvas: template.canvas.fabric as ExportedLabelTemplate["canvas"],
    label: template.canvas.label,
    thumbnailBase64: template.canvas.thumbnail,
    timestamp: Date.parse(template.created_at) || undefined,
    model: template.model,
    dpmm: template.canvas.dpmm ?? DEFAULT_DPMM,
    variables: template.variables,
    tags: template.tags,
    assetIds: template.asset_ids,
  };
}

export class TemplateStore {
  /** Compact list for the gallery and the saved-labels browser. */
  async list(): Promise<TemplateSummary[]> {
    return api.listTemplates();
  }

  /** Load one template with its full canvas document. */
  async load(id: string): Promise<ExportedLabelTemplate> {
    return fromServerTemplate(await api.getTemplate(id));
  }

  /**
   * Create or update, depending on whether the template already has a server id.
   * Returns the stored template.
   */
  async save(template: ExportedLabelTemplate): Promise<ExportedLabelTemplate> {
    const payload = toPayload(template);

    if (template.id === undefined) {
      return fromServerTemplate(await api.createTemplate(payload));
    }

    return fromServerTemplate(await api.updateTemplate(template.id, payload));
  }

  async delete(id: string): Promise<void> {
    await api.deleteTemplate(id);
  }

  async duplicate(id: string): Promise<ExportedLabelTemplate> {
    return fromServerTemplate(await api.duplicateTemplate(id));
  }

  async versions(id: string) {
    return api.listVersions(id);
  }

  async restoreVersion(id: string, versionId: string): Promise<ExportedLabelTemplate> {
    return fromServerTemplate(await api.restoreVersion(id, versionId));
  }
}

export const templateStore = new TemplateStore();
