/**
 * Shared label rendering pipeline.
 *
 * Both the manual print preview and the CSV batch runner render labels through
 * this module, so a batch row and a manual label go through exactly the same
 * steps: merge variables → mirror objects → render → 1-bit post-process.
 *
 * The steps mirror upstream niimblue's `PrintPreview.generatePreviewData` and
 * `updatePreview`, extracted here so they can be reused and unit-tested.
 */

import { CustomCanvas } from "$/fabric-object/custom_canvas";
import { canvasPreprocess } from "$/utils/canvas_preprocess";
import * as effects from "$/utils/post_process";
import type { FabricJson, LabelProps, PostProcessType } from "$/types";

export type RenderParams = {
  postProcess: PostProcessType;
  postProcessInvert: boolean;
  postProcessMirror: boolean;
  threshold: number;
  thresholdRed: number;
  strength: number;
  serpentine: boolean;
  screentoneDotSize: number;
  screentoneAngle: number;
  contrast: number;
  brightness: number;
  offset: {
    x: number;
    y: number;
    offsetType: "inner" | "outer";
  };
};

export const DEFAULT_RENDER_PARAMS: RenderParams = {
  postProcess: "threshold",
  postProcessInvert: false,
  postProcessMirror: false,
  threshold: 140,
  thresholdRed: 100,
  strength: 1,
  serpentine: true,
  screentoneDotSize: 5,
  screentoneAngle: 45,
  contrast: 60,
  brightness: 128,
  offset: { x: 0, y: 0, offsetType: "inner" },
};

/**
 * Apply the 1-bit post-processing to a rendered canvas.
 * The result is what actually reaches the print head.
 */
export function applyPostProcess(image: ImageData, params: RenderParams): ImageData {
  const ditherOpts = {
    threshold: params.threshold,
    strength: params.strength,
    serpentine: params.serpentine,
  };

  const processors: Record<PostProcessType, (data: ImageData) => ImageData> = {
    threshold: (data) => effects.threshold(data, params.threshold),
    threshold_rb: (data) => effects.thresholdRedBlack(data, params.threshold, params.thresholdRed),
    dither: (data) => effects.atkinson(data, ditherOpts),
    floyd_steinberg: (data) => effects.floydSteinberg(data, ditherOpts),
    jjn: (data) => effects.jarvisJudiceNinke(data, ditherOpts),
    stucki: (data) => effects.stucki(data, ditherOpts),
    bayer2: (data) => effects.bayer(data, 2),
    bayer4: (data) => effects.bayer(data, 4),
    bayer8: (data) => effects.bayer(data, 8),
    screentone: (data) =>
      effects.screentone(
        data,
        params.threshold,
        params.screentoneDotSize,
        params.screentoneAngle,
        params.contrast,
      ),
    grayscale: (data) => effects.grayscale(data, params.contrast, params.brightness),
  };

  let data = processors[params.postProcess](effects.copyImageData(image));

  if (params.postProcessInvert) {
    data = effects.invert(data);
  }

  if (params.postProcessMirror) {
    data = effects.mirror(data);
  }

  return data;
}

/**
 * Render one label.
 *
 * @param fabricJson the template's canvas document
 * @param labelProps the label geometry
 * @param variables  merged variable values (already resolved from the CSV row)
 * @param params     1-bit post-processing settings
 */
export async function renderLabelCanvas(
  fabricJson: FabricJson,
  labelProps: LabelProps,
  variables: Record<string, string> | undefined,
  params: RenderParams,
): Promise<HTMLCanvasElement> {
  const fabricCanvas = new CustomCanvas(undefined, {
    width: labelProps.size.width,
    height: labelProps.size.height,
  });

  try {
    fabricCanvas.setCustomBackground(false);
    fabricCanvas.setHighlightMirror(false);
    fabricCanvas.setLabelProps(labelProps);

    await fabricCanvas.loadFromJSON(fabricJson);

    canvasPreprocess(fabricCanvas, variables);

    await fabricCanvas.createMirroredObjects();

    fabricCanvas.requestRenderAll();

    const preRendered = fabricCanvas.toCanvasElement(1);
    const ctx = preRendered.getContext("2d")!;
    const originalImage = ctx.getImageData(0, 0, preRendered.width, preRendered.height);

    const processed = applyPostProcess(originalImage, params);

    const output = document.createElement("canvas");

    if (params.offset.offsetType === "inner") {
      output.width = originalImage.width;
      output.height = originalImage.height;
      const outCtx = output.getContext("2d")!;
      outCtx.fillStyle = "white";
      outCtx.fillRect(0, 0, output.width, output.height);
      outCtx.putImageData(processed, params.offset.x, params.offset.y);
    } else {
      output.width = originalImage.width + Math.abs(params.offset.x);
      output.height = originalImage.height + Math.abs(params.offset.y);
      const outCtx = output.getContext("2d")!;
      outCtx.fillStyle = "white";
      outCtx.fillRect(0, 0, output.width, output.height);
      outCtx.putImageData(processed, Math.max(params.offset.x, 0), Math.max(params.offset.y, 0));
    }

    return output;
  } finally {
    fabricCanvas.dispose();
  }
}

/**
 * §5.1: the raster must never exceed the print head width.
 *
 * The width rules live in `print_limits.ts`, which both the manual preview
 * and the batch runner use, so the two paths cannot drift apart.
 */
