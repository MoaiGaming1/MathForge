function validRange(range) {
  return Array.isArray(range) && range.length === 2
    && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1];
}

export function equalUnitRanges(xRange, yRange, pixelWidth, pixelHeight) {
  if (!validRange(xRange) || !validRange(yRange) || !(pixelWidth > 0) || !(pixelHeight > 0)) return { x: xRange, y: yRange };
  const centerX = (xRange[0] + xRange[1]) / 2;
  const centerY = (yRange[0] + yRange[1]) / 2;
  const scale = Math.min(pixelWidth / (xRange[1] - xRange[0]), pixelHeight / (yRange[1] - yRange[0]));
  const halfX = pixelWidth / scale / 2;
  const halfY = pixelHeight / scale / 2;
  return { x: [centerX - halfX, centerX + halfX], y: [centerY - halfY, centerY + halfY] };
}

export function panRanges(xRange, yRange, dxPixels, dyPixels, pixelWidth, pixelHeight) {
  const range = equalUnitRanges(xRange, yRange, pixelWidth, pixelHeight);
  const unitsPerPixel = (range.x[1] - range.x[0]) / pixelWidth;
  const shiftX = -dxPixels * unitsPerPixel;
  const shiftY = dyPixels * unitsPerPixel;
  return { x: range.x.map((value) => value + shiftX), y: range.y.map((value) => value + shiftY) };
}

export function zoomRangesAt(xRange, yRange, xFraction, yFraction, factor, pixelWidth, pixelHeight) {
  const range = equalUnitRanges(xRange, yRange, pixelWidth, pixelHeight);
  const zoom = Math.max(0.05, Math.min(20, factor));
  const anchorX = range.x[0] + Math.max(0, Math.min(1, xFraction)) * (range.x[1] - range.x[0]);
  const anchorY = range.y[1] - Math.max(0, Math.min(1, yFraction)) * (range.y[1] - range.y[0]);
  const width = (range.x[1] - range.x[0]) * zoom;
  const height = (range.y[1] - range.y[0]) * zoom;
  const minX = anchorX - Math.max(0, Math.min(1, xFraction)) * width;
  const maxY = anchorY + Math.max(0, Math.min(1, yFraction)) * height;
  return { x: [minX, minX + width], y: [maxY - height, maxY] };
}
