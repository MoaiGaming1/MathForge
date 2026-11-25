export const defaultVisualizationSettings = {
  mode: "result",
  result: { precision: 30 },
  graph2d: { xRange: [-10, 10], yRange: [-10, 10], samples: 401, color: "#a8cb82" },
  complexPlane: { realRange: [-10, 10], imaginaryRange: [-10, 10], precision: 30, color: "#a8cb82" },
  graph3d: { xRange: [-10, 10], yRange: [-10, 10], zRange: [-10, 10], resolution: 24, parameterRange: [0, 6.283185307179586], color: "#a8cb82", camera: { rotation: [0.75, 0.6], zoom: 1, pan: [0, 0] } },
};
