
// Is the design upright after the app adopts the printer and applies the
// media it reports? Everything is numeric, so the answer is unambiguous.
const { ImageEncoder } = require("@mmote/niimbluelib");

// A canvas with a marker at a known place.
const makeCanvas = (w, h, mx, my) => {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 0; i < data.length; i += 4) { data[i]=0; data[i+1]=0; data[i+2]=0; }
  const i = (my*w+mx)*4; data[i]=255; data[i+1]=0; data[i+2]=0;
  return { data, width: w, height: h };
};

// The marker position in the printed raster: output(row=along, col=across).
const markerIn = (src, direction) => {
  const W = src.width, H = src.height;
  const cols = direction === "left" ? H : W;
  const rows = direction === "left" ? W : H;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const idx = direction === "left" ? (H-1-col)*W + row : row*W + col;
      if (src.data[idx*4] === 255 && src.data[idx*4+1] === 0) return { along: row, across: col };
    }
  return null;
};

// The template as stored: a 320x160 canvas in the D11 ("left") convention,
// with its marker at the canvas's top-left.
const W = 320, H = 160;
const template = makeCanvas(W, H, 5, 5);
console.log("template 320x160 left  -> printed marker:", JSON.stringify(markerIn(template, "left")));

// The app adopts the B21: direction becomes "top", the canvas is transposed
// and the content turned a quarter. This is what turnContent does.
const CX = W/2, CY = H/2, NCX = H/2, NCY = W/2;
const turned = (() => {
  const c = makeCanvas(H, W, 0, 0);
  const mx = 5, my = 5;
  const dx = mx - CX, dy = my - CY;
  // rotate the object's own frame +90: a point (u,v) -> (u,v) about the object centre
  const ox = mx, oy = my;
  const rx = ox - (oy - oy), ry = oy + (ox - ox);   // the centre is unchanged by the rotation
  // the centre then moves by (-dy, dx) and the canvas centre shifts
  const nx = ox + (CX - dy - ox) + (NCX - CX);
  const ny = oy + (CY + dx - oy) + (NCY - CY);
  // the object's content is rotated: its own corners swap
  const relx = ox - rx, rely = oy - ry;             // 0,0 for a point object
  const px = Math.round(nx), py = Math.round(ny);
  c.data[(py*H+px)*4]=255; c.data[(py*H+px)*4+1]=0; c.data[(py*H+px)*4+2]=0;
  return c;
})();
console.log("after adopting top   -> printed marker:", JSON.stringify(markerIn(turned, "top")));
console.log("   the raster is now", turned.width, "across x", turned.height, "along");
