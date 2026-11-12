/**
 * Typed client for the LabelBench central server (§6).
 *
 * The server is the single source of truth for templates and assets: no template
 * is ever stored in the browser (M1 acceptance criterion).
 */

import type {
  Orientation,
  ServerCanvasDocument,
  ServerTemplate,
  TemplateModel,
  TemplateSummary,
  TemplateVariables,
} from "$/types";

export type ApiError = Error & {
  status?: number;
  body?: unknown;
};

/**
 * The shared API key, when the server has the gate switched on.
 *
 * Phase 1 runs with no auth, so this is normally empty. It is kept here so
 * that turning the gate on needs no change to the editor — the client picks
 * the key up and sends it with every request.
 */
const API_KEY_STORAGE = "labelbench_api_key";

export const apiKeyStore = {
  get(): string {
    try {
      return localStorage.getItem(API_KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  },

  set(key: string): void {
    try {
      if (key === "") {
        localStorage.removeItem(API_KEY_STORAGE);
      } else {
        localStorage.setItem(API_KEY_STORAGE, key);
      }
    } catch (e) {
      console.warn("Could not store the API key", e);
    }
  },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  const apiKey = apiKeyStore.get();

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(apiKey === "" ? {} : { "X-API-Key": apiKey }),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    const error = new Error(
      `Cannot reach the LabelBench server at ${location.origin}. Is it running? (${String(e)})`,
    ) as ApiError;
    throw error;
  }

  if (!response.ok) {
    let body: unknown = undefined;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    const error = new Error(
      response.status === 401
        ? `This LabelBench server requires an API key (401 — ${path}). Set one in Settings.`
        : `${response.status} ${response.statusText} — ${path}`,
    ) as ApiError;
    error.status = response.status;
    error.body = body;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type TemplatePayload = {
  name: string;
  model: TemplateModel;
  label_w_mm: number;
  label_h_mm: number;
  orientation: Orientation;
  canvas: ServerCanvasDocument;
  variables?: TemplateVariables;
  asset_ids?: string[];
  tags?: string[];
};

export const api = {
  health: () => request<{ status: string; service: string; time: string }>("/api/health"),

  listTemplates: () => request<{ templates: TemplateSummary[] }>("/api/templates").then((r) => r.templates),

  getTemplate: (id: string) => request<{ template: ServerTemplate }>(`/api/templates/${id}`).then((r) => r.template),

  createTemplate: (payload: TemplatePayload) =>
    request<{ template: ServerTemplate }>("/api/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    }).then((r) => r.template),

  updateTemplate: (id: string, payload: TemplatePayload) =>
    request<{ template: ServerTemplate }>(`/api/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }).then((r) => r.template),

  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" }),

  duplicateTemplate: (id: string) =>
    request<{ template: ServerTemplate }>(`/api/templates/${id}/duplicate`, { method: "POST" }).then(
      (r) => r.template,
    ),

  listVersions: (id: string) =>
    request<{ versions: Array<{ id: string; version: number; created_at: string }> }>(
      `/api/templates/${id}/versions`,
    ).then((r) => r.versions),

  restoreVersion: (id: string, versionId: string) =>
    request<{ template: ServerTemplate }>(`/api/templates/${id}/versions/${versionId}/restore`, {
      method: "POST",
    }).then((r) => r.template),

  listAssets: () => request<{ assets: AssetInfo[] }>("/api/assets").then((r) => r.assets),

  uploadAsset: (file: File | Blob, filename: string) => {
    const form = new FormData();
    form.append("file", file, filename);
    return request<{ asset: AssetInfo }>("/api/assets", { method: "POST", body: form }).then(
      (r) => r.asset,
    );
  },

  assetUrl: (id: string) => `/api/assets/${id}`,

  /**
   * The central serial counters.
   *
   * A counter is what makes a serial number central: two workstations
   * printing the same template draw from the same sequence, and the number
   * keeps climbing across restarts and across batches.
   */
  listSerialCounters: () =>
    request<{ counters: SerialCounter[] }>("/api/serial-counters").then((r) => r.counters),

  /**
   * Take the next number from a counter.
   *
   * The server allocates it atomically, so two machines printing at the same
   * moment can never be handed the same number.
   */
  nextSerialValue: (name: string, opts?: { start?: number; step?: number }) =>
    request<SerialCounter>(`/api/serial-counters/${encodeURIComponent(name)}/next`, {
      method: "POST",
      body: JSON.stringify(opts ?? {}),
    }),

  resetSerialCounter: (name: string, value?: number) =>
    request<SerialCounter>(`/api/serial-counters/${encodeURIComponent(name)}/reset`, {
      method: "POST",
      body: JSON.stringify(value === undefined ? {} : { value }),
    }),
};

export type SerialCounter = {
  name: string;
  value: number;
  updated_at: string;
};

export type AssetInfo = {
  id: string;
  filename: string;
  mime: string;
  path: string;
  size_bytes: number;
  kind: "image" | "font" | "other";
  created_at: string;
  /** Font metadata, when the asset is a font. */
  meta?: {
    family?: string;
    mimeType?: string;
    gzipped?: boolean;
  };
};
