/**
 * Server-side asset handling.
 *
 * §5.3: a template stores "references to any uploaded assets", and §6 exposes
 * `POST /api/assets` / `GET /api/assets/:id`.
 *
 * Fabric.js embeds image bitmaps as `data:` URLs inside the serialised object
 * graph. Left alone, every template would carry its own copy of every image and
 * the library would grow without bound. Instead, images are uploaded once to the
 * server and the template keeps a reference marker (`asset:<id>`) in their place.
 * The bytes are fetched back when the template is opened.
 */

import { api } from "$/services/api";
import type { FabricJson } from "$/types";

const ASSET_MARKER_PREFIX = "asset:";

export type AssetRef = {
  id: string;
  /** Original data URL, kept so the upload can be skipped when unchanged. */
  dataUrl: string;
};

type FabricObjectLike = {
  type?: string;
  src?: string;
  [key: string]: unknown;
};

function isImageObject(obj: FabricObjectLike): boolean {
  return obj.type === "image" || obj.type === "Image" || typeof obj.src === "string";
}

/**
 * Replace image data URLs with server asset references.
 *
 * Returns the rewritten canvas document and the list of asset ids the template
 * now references.
 */
export async function extractAssets(canvas: FabricJson): Promise<{
  canvas: FabricJson;
  assetIds: string[];
}> {
  const objects = (canvas.objects ?? []) as unknown as FabricObjectLike[];
  const assetIds: string[] = [];
  const rewritten: FabricObjectLike[] = [];

  // One upload per distinct bitmap, even if the same image is used twice.
  const uploaded = new Map<string, string>();

  for (const obj of objects) {
    const src = obj.src;

    if (!isImageObject(obj) || typeof src !== "string" || !src.startsWith("data:")) {
      rewritten.push(obj);
      continue;
    }

    let assetId = uploaded.get(src);

    if (assetId === undefined) {
      const blob = dataUrlToBlob(src);
      const asset = await api.uploadAsset(blob, filenameFromDataUrl(src));
      assetId = asset.id;
      uploaded.set(src, assetId);
    }

    assetIds.push(assetId);
    rewritten.push({ ...obj, src: `${ASSET_MARKER_PREFIX}${assetId}` });
  }

  return {
    canvas: { ...canvas, objects: rewritten } as unknown as FabricJson,
    assetIds,
  };
}

/**
 * Resolve `asset:<id>` markers back into data URLs so Fabric can load them.
 */
export async function resolveAssets(canvas: FabricJson): Promise<FabricJson> {
  const objects = (canvas.objects ?? []) as unknown as FabricObjectLike[];
  const cache = new Map<string, string>();

  const resolved: FabricObjectLike[] = [];

  for (const obj of objects) {
    const src = obj.src;

    if (typeof src !== "string" || !src.startsWith(ASSET_MARKER_PREFIX)) {
      resolved.push(obj);
      continue;
    }

    const assetId = src.slice(ASSET_MARKER_PREFIX.length);

    let dataUrl = cache.get(assetId);

    if (dataUrl === undefined) {
      dataUrl = await fetchAssetAsDataUrl(assetId);
      cache.set(assetId, dataUrl);
    }

    resolved.push({ ...obj, src: dataUrl });
  }

  return { ...canvas, objects: resolved } as unknown as FabricJson;
}

async function fetchAssetAsDataUrl(assetId: string): Promise<string> {
  const response = await fetch(api.assetUrl(assetId));

  if (!response.ok) {
    throw new Error(`Asset ${assetId} could not be loaded (${response.status})`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header ?? "")?.[1] ?? "application/octet-stream";

  if (payload === undefined) {
    throw new Error("Malformed data URL");
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function filenameFromDataUrl(dataUrl: string): string {
  const mime = /data:([^;]+)/.exec(dataUrl)?.[1] ?? "image/png";
  const extension = mime.split("/")[1]?.replace("+xml", "") ?? "png";
  return `image.${extension}`;
}
