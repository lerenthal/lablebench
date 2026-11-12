import * as fabric from "fabric";
import { OBJECT_DEFAULTS, OBJECT_DEFAULTS_TEXT, OBJECT_DEFAULTS_VECTOR, OBJECT_SIZE_DEFAULTS } from "$/defaults";
import { ArUcoMarker } from "$/fabric-object/aruco";
import Barcode from "$/fabric-object/barcode";
import { QRCode } from "$/fabric-object/qrcode";
import type { OjectType } from "$/types";
import {
  DEFAULT_DATE_TIME_FORMAT,
  dateTimeToken,
  preprocessDateTime,
  serialToken,
} from "$/utils/dynamic_values";
import { Toasts } from "$/utils/toasts";
import { FileUtils } from "$/utils/file_utils";
import { CanvasUtils } from "$/utils/canvas_utils";
import { TextboxExt, TextboxExtProps } from "$/fabric-object/textbox-ext";

export class LabelDesignerObjectHelper {
  static async addSvg(canvas: fabric.Canvas, svgCode: string): Promise<fabric.FabricObject | fabric.Group> {
    const { objects, options } = await fabric.loadSVGFromString(svgCode);
    const obj = fabric.util.groupSVGElements(
      objects.filter((o) => o !== null),
      options,
    );
    obj.set({ ...OBJECT_DEFAULTS });
    CanvasUtils.fitObjectIntoCanvas(canvas, obj, OBJECT_DEFAULTS.left, OBJECT_DEFAULTS.top);
    canvas.add(obj);
    canvas.renderAll();
    return obj;
  }

  static async addImageFile(canvas: fabric.Canvas, file: File): Promise<fabric.FabricObject | fabric.Group> {
    if (file.type.startsWith("image/svg")) {
      const data = await file.text();
      return await this.addSvg(canvas, data);
    }

    if (file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/bmp" || file.type === "image/gif") {
      const url = await FileUtils.blobToDataUrl(file);
      const fabricImg = await fabric.FabricImage.fromURL(url);
      fabricImg.set({ ...OBJECT_DEFAULTS });
      CanvasUtils.fitObjectIntoCanvas(canvas, fabricImg, OBJECT_DEFAULTS.left, OBJECT_DEFAULTS.top);
      canvas.add(fabricImg);
      return fabricImg;
    }

    throw new Error("Unsupported image");
  }

  static async addImageWithFilePicker(fabricCanvas: fabric.Canvas): Promise<fabric.FabricObject | fabric.Group> {
    const files = await FileUtils.pickFileAsync("*", false);
    try {
      return await this.addImageFile(fabricCanvas, files[0]);
    } catch (e) {
      // fixme: catch error in other place
      Toasts.error(e);
      throw e;
    }
  }

  static async addImageBlob(fabricCanvas: fabric.Canvas, img: Blob): Promise<fabric.FabricImage> {
    const url = await FileUtils.blobToDataUrl(img);
    const fabricImg = await fabric.FabricImage.fromURL(url);
    fabricImg.set({ left: 0, top: 0, snapAngle: OBJECT_DEFAULTS.snapAngle });
    fabricCanvas.add(fabricImg);
    return fabricImg;
  }

  static async addObjectFromClipboard(
    fabricCanvas: fabric.Canvas,
    data: DataTransfer,
  ): Promise<fabric.FabricObject | undefined> {
    // paste image
    for (const item of data.items) {
      if (item.type.includes("image")) {
        const file = item.getAsFile();
        if (file) {
          return await LabelDesignerObjectHelper.addImageFile(fabricCanvas, file);
        }
      }
    }

    // paste text
    const text = data.getData("text");
    if (text) {
      const obj = LabelDesignerObjectHelper.addText(fabricCanvas, text);
      fabricCanvas.setActiveObject(obj);
      return obj;
    }
  }

  static addText(canvas: fabric.Canvas, text?: string, options?: Partial<TextboxExtProps>): TextboxExt {
    const obj = new TextboxExt(text ?? "Text", {
      ...OBJECT_DEFAULTS_TEXT,
      ...options,
    });
    canvas.add(obj);
    canvas.centerObject(obj);
    return obj;
  }

  /**
   * A Date & time object.
   *
   * The canvas shows the moment it would produce right now; the token is kept
   * on the object so the template stores `{dt|...}` rather than today's date.
   */
  static addDateTime(canvas: fabric.Canvas, format?: string): TextboxExt {
    const usedFormat = format ?? DEFAULT_DATE_TIME_FORMAT;
    const obj = new TextboxExt(preprocessDateTime(usedFormat), {
      ...OBJECT_DEFAULTS_TEXT,
    });

    obj.dynamicToken = dateTimeToken(usedFormat);
    // The value is decided at print time, so typing over it would only
    // replace a live value with a dead one. The format is edited in the
    // object's own panel instead.
    obj.editable = false;

    canvas.add(obj);
    canvas.centerObject(obj);
    return obj;
  }

  /**
   * A Serial number object.
   *
   * The value comes from the template's central counter at print time. Until
   * the counter has been read the object shows a placeholder rather than the
   * raw token, so the label does not look broken on the canvas.
   */
  static addSerial(canvas: fabric.Canvas, variable: string): TextboxExt {
    const obj = new TextboxExt("—", {
      ...OBJECT_DEFAULTS_TEXT,
    });

    obj.dynamicToken = serialToken(variable);
    obj.editable = false;

    canvas.add(obj);
    canvas.centerObject(obj);
    return obj;
  }

  static addStaticText(canvas: fabric.Canvas, text?: string, options?: Partial<fabric.TextProps>): fabric.FabricText {
    const obj = new fabric.FabricText(text ?? "Text", {
      ...OBJECT_DEFAULTS_TEXT,
      ...options,
    });
    canvas.add(obj);
    canvas.centerObject(obj);
    return obj;
  }

  static addHLine(canvas: fabric.Canvas): fabric.Polyline {
    const obj = new fabric.Polyline(
      [
        { x: OBJECT_DEFAULTS.left, y: OBJECT_DEFAULTS.top },
        { x: OBJECT_DEFAULTS.left + OBJECT_SIZE_DEFAULTS.width, y: OBJECT_DEFAULTS.top },
      ],
      { ...OBJECT_DEFAULTS_VECTOR },
    );
    canvas.add(obj);
    canvas.centerObjectV(obj);
    return obj;
  }

  static addCircle(canvas: fabric.Canvas): fabric.Circle {
    const obj = new fabric.Circle({
      ...OBJECT_DEFAULTS_VECTOR,
      radius: OBJECT_SIZE_DEFAULTS.width / 2,
    });
    canvas.add(obj);
    canvas.centerObjectV(obj);
    return obj;
  }

  static addRect(canvas: fabric.Canvas): fabric.Rect {
    const obj = new fabric.Rect({
      ...OBJECT_SIZE_DEFAULTS,
      ...OBJECT_DEFAULTS_VECTOR,
    });
    canvas.add(obj);
    canvas.centerObjectV(obj);
    return obj;
  }

  static addQrCode(canvas: fabric.Canvas): QRCode {
    const qr = new QRCode({
      text: "NiimBlue",
      ...OBJECT_SIZE_DEFAULTS,
      ...OBJECT_DEFAULTS,
    });
    canvas.add(qr);
    return qr;
  }

  static addArUco(canvas: fabric.Canvas): ArUcoMarker {
    const aruco = new ArUcoMarker({
      ...OBJECT_SIZE_DEFAULTS,
      ...OBJECT_DEFAULTS,
    });
    canvas.add(aruco);
    return aruco;
  }

  static addBarcode(canvas: fabric.Canvas): Barcode {
    const barcode = new Barcode({
      ...OBJECT_DEFAULTS,
      text: "123456789012",
      height: OBJECT_SIZE_DEFAULTS.height,
      encoding: "CODE128B",
    });
    canvas.add(barcode);
    return barcode;
  }

  static addObject(
    canvas: fabric.Canvas,
    objType: OjectType,
    options?: { dateTimeFormat?: string; serialVariable?: string },
  ): fabric.FabricObject | undefined {
    switch (objType) {
      case "text":
        return this.addText(canvas);
      case "line":
        return this.addHLine(canvas);
      case "circle":
        return this.addCircle(canvas);
      case "rectangle":
        return this.addRect(canvas);
      case "image":
        this.addImageWithFilePicker(canvas);
        return;
      case "qrcode":
        return this.addQrCode(canvas);
      case "aruco":
        return this.addArUco(canvas);
      case "barcode":
        return this.addBarcode(canvas);
      case "datetime":
        return this.addDateTime(canvas, options?.dateTimeFormat);
      case "serial":
        return this.addSerial(canvas, options?.serialVariable ?? "serial");
    }
  }
}
