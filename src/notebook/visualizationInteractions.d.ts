export interface CoordinateRange { x: [number, number]; y: [number, number] }
export function equalUnitRanges(xRange: [number, number], yRange: [number, number], pixelWidth: number, pixelHeight: number): CoordinateRange;
export function panRanges(xRange: [number, number], yRange: [number, number], dxPixels: number, dyPixels: number, pixelWidth: number, pixelHeight: number): CoordinateRange;
export function zoomRangesAt(xRange: [number, number], yRange: [number, number], xFraction: number, yFraction: number, factor: number, pixelWidth: number, pixelHeight: number): CoordinateRange;
