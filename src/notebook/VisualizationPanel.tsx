import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import type { DisplayMode, VisualizationSettings } from "../types/notebook";
import type { VisualizationResult } from "../types/engine";
import { equalUnitRanges, panRanges, zoomRangesAt } from "./visualizationInteractions.js";

type Props = { mode: DisplayMode; settings: VisualizationSettings; result?: VisualizationResult; loading: boolean; error?: string; shared?: boolean; colorOverride?: string; onChange: (mode: DisplayMode, patch: Record<string, unknown>) => void };
export type SharedVisualizationPlot = { id: string; label: string; mode: DisplayMode; settings: VisualizationSettings; result?: VisualizationResult; color?: string };

const PLOT_COLORS = ["#a8cb82", "#76b7eb", "#e5989b", "#c7a6e8", "#f1c27d", "#73cbbb", "#e889cb", "#a7b2c4"];
const DEFAULT_PLOT_COLOR = "#a8cb82";
const resultObjectIds = new WeakMap<object, number>();
let nextResultObjectId = 1;
const meshCache = new WeakMap<VisualizationResult, Tri[]>();

function plotSignature(plots: SharedVisualizationPlot[]): string {
  return plots.map((plot) => {
    const result = plot.result;
    if (!result) return `${plot.id}:pending:${plot.color ?? ""}`;
    let id = resultObjectIds.get(result);
    if (!id) { id = nextResultObjectId++; resultObjectIds.set(result, id); }
    return `${plot.id}:${id}:${plot.color ?? ""}`;
  }).join("|");
}

export function sharedPlotColor(settings: VisualizationSettings, index: number): string {
  const color = settings[settings.mode === "graph2d" ? "graph2d" : settings.mode === "complexPlane" ? "complexPlane" : "graph3d"].color;
  return color === DEFAULT_PLOT_COLOR ? PLOT_COLORS[index % PLOT_COLORS.length] : color;
}

export function VisualizationPanel({ mode, settings, result, loading, error, shared = false, colorOverride, onChange }: Props) {
  if (mode === "result") return null;
  const config = mode === "graph2d" ? settings.graph2d : mode === "complexPlane" ? settings.complexPlane : settings.graph3d;
  const color = colorOverride ?? config.color;
  const ranges = mode === "complexPlane" ? [["Real", "realRange"], ["Imaginary", "imaginaryRange"]] : [["x", "xRange"], ["y", "yRange"], ...(mode === "graph3d" ? [["z", "zRange"]] : [])];
  const saveRange = (event: React.ChangeEvent<HTMLInputElement>, key: string, index: 0 | 1) => {
    const value = Number(event.currentTarget.value);
    if (!Number.isFinite(value)) return;
    const mapped = mode === "complexPlane" ? (key === "xRange" ? "realRange" : "imaginaryRange") : key;
        const range = [...(config[mapped as keyof typeof config] as unknown as [number, number])] as [number, number];
    range[index] = value;
    if (range[0] >= range[1] || Math.max(Math.abs(range[0]), Math.abs(range[1])) > 1e6) return;
    onChange(mode, { [mapped]: range });
  };
  return <section className="visualization-panel" aria-label={mode + " visualization"}>
    <div className="visualization-toolbar">
      {!shared && ranges.map(([label, key]) => {
        const mapped = mode === "complexPlane" ? (key === "xRange" ? "realRange" : "imaginaryRange") : key;
        const range = config[mapped as keyof typeof config] as unknown as [number, number];
        return <fieldset className="visualization-range" key={key}><legend>{label}</legend>{[0, 1].map((index) => <input key={index} aria-label={label + (index === 0 ? " minimum" : " maximum")} type="number" step="any" value={range[index]} onChange={(event) => saveRange(event, key, index as 0 | 1)} />)}</fieldset>;
      })}
      {mode === "graph2d" && <label className="visualization-density">Samples<input aria-label="2D graph samples" type="number" min="40" max="1000" value={settings.graph2d.samples} onChange={(event) => { const value=Number(event.target.value); if(Number.isInteger(value)&&value>=40&&value<=1000)onChange(mode,{samples:value}); }} /></label>}
      {mode === "complexPlane" && <label className="visualization-density">Digits<input aria-label="Complex coordinate precision" type="number" min="10" max="100" value={settings.complexPlane.precision} onChange={(event) => { const value=Number(event.target.value); if(Number.isInteger(value)&&value>=10&&value<=100)onChange(mode,{precision:value}); }} /></label>}
      {mode === "graph3d" && <>
        <label className="visualization-density">Resolution<input aria-label="3D sampling resolution" type="number" min="8" max="32" value={settings.graph3d.resolution} onChange={(event) => { const value=Number(event.target.value); if(Number.isInteger(value)&&value>=8&&value<=32)onChange(mode,{resolution:value}); }} /></label>
        <fieldset className="visualization-range"><legend>t</legend>{[0,1].map((index)=><input key={index} aria-label={"Parameter t " +(index===0?"minimum":"maximum")} type="number" step="any" value={settings.graph3d.parameterRange[index]} onChange={(event)=>{const value=Number(event.target.value), next=[...settings.graph3d.parameterRange] as [number,number];if(!Number.isFinite(value))return;next[index as 0|1]=value;if(next[0]<next[1]&&Math.max(Math.abs(next[0]),Math.abs(next[1]))<1e6)onChange(mode,{parameterRange:next});}} />)}</fieldset>
      </>}
      <label className="visualization-color">Color<input type="color" value={color} onChange={(event) => onChange(mode, { color: event.target.value })} /></label>
      {!shared && mode === "graph2d" && <>
        <button className="visualization-reset" onClick={() => { const points=(result?.series??[]).flatMap((series)=>series.points??[]).filter((point)=>point[1]!==null);if(points.length){onChange(mode,{xRange:paddedRange(points.map(point=>point[0])),yRange:paddedRange(points.map(point=>point[1] as number))});} }}>Auto scale</button>
        <button className="visualization-reset" onClick={() => onChange(mode,{xRange:[-10,10],yRange:[-10,10]})}>Reset view</button>
      </>}
      {!shared && mode === "complexPlane" && <>
        <button className="visualization-reset" onClick={() => { const points=result?.points??[];if(points.length)onChange(mode,{realRange:paddedRange(points.map(point=>point.real)),imaginaryRange:paddedRange(points.map(point=>point.imaginary))}); }}>Auto scale</button>
        <button className="visualization-reset" onClick={() => onChange(mode,{realRange:[-10,10],imaginaryRange:[-10,10]})}>Reset view</button>
      </>}
      {!shared && mode === "graph3d" && <button className="visualization-reset" onClick={() => onChange(mode, { camera: { rotation: [0.75, 0.6], zoom: 1, pan: [0, 0] } })}>Reset view</button>}
    </div>
    {loading && <div className="visualization-status" role="status">Sampling…</div>}
    {error && <div className="visualization-error" role="alert">{error}</div>}
    {!shared && !loading && result && mode === "graph2d" && <Graph2D plots={[{ id: "single", label: "", mode, settings, result }]} settings={settings} />}
    {!shared && !loading && result && mode === "complexPlane" && <ComplexPlane plots={[{ id: "single", label: "", mode, settings, result }]} settings={settings} />}
    {!shared && !loading && result && mode === "graph3d" && <Graph3D plots={[{ id: "single", label: "", mode, settings, result }]} settings={settings} onChange={onChange} />}
    {result && <p className="approximation-warning">{result.warning}</p>}
  </section>;
}

export function SharedVisualizationDashboard({ plots, onChange }: { plots: SharedVisualizationPlot[]; onChange: (mode: DisplayMode, patch: Record<string, unknown>) => void }) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  return <div className="shared-visualizations">
    {(["graph2d", "complexPlane", "graph3d"] as const).map((mode) => {
      const group = plots.filter((plot) => plot.mode === mode);
      if (!group.length) return null;
      const settings = group[0].settings;
      const visible = group.filter((plot) => !hidden[plot.id]);
      const ready = visible.filter((plot) => plot.result);
      const toggle = (id: string) => setHidden((current) => ({ ...current, [id]: !current[id] }));
      const range = (label: string, key: string, values: [number, number], patchKey = key) => <fieldset className="visualization-range" key={key}>
        <legend>{label}</legend>{[0, 1].map((index) => <input key={index} aria-label={`${mode} ${label} ${index ? "maximum" : "minimum"}`} type="number" step="any" value={values[index]} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (!Number.isFinite(value)) return;
          const next = [...values] as [number, number];
          next[index as 0 | 1] = value;
          if (next[0] < next[1] && Math.max(Math.abs(next[0]), Math.abs(next[1])) <= 1e6) onChange(mode, { [patchKey]: next });
        }} />)}
      </fieldset>;
      return <section className="shared-visualization" key={mode} aria-label={`Shared ${mode} graph`}>
        <header className="shared-visualization-heading"><strong>{mode === "graph2d" ? "2D graph" : mode === "complexPlane" ? "Complex plane" : "3D scene"}</strong>
          <div className="shared-plot-legend">{group.map((plot, index) => <label key={plot.id} title={plot.label}>
            <input type="checkbox" checked={!hidden[plot.id]} onChange={() => toggle(plot.id)} />
            <i style={{ backgroundColor: plot.color ?? sharedPlotColor(plot.settings, index) }} />
            <span>{plot.label}</span>
          </label>)}</div>
        </header>
        <div className="visualization-toolbar shared-visualization-toolbar">
          {mode === "graph2d" && <>{range("x", "xRange", settings.graph2d.xRange)}{range("y", "yRange", settings.graph2d.yRange)}
            <button className="visualization-reset" onClick={() => { const fitted = fit2D(ready); if (fitted) onChange(mode, fitted); }}>Fit to content</button>
            <button className="visualization-reset" onClick={() => onChange(mode, { xRange: [-10, 10], yRange: [-10, 10] })}>Reset view</button>
          </>}
          {mode === "complexPlane" && <>{range("Real", "realRange", settings.complexPlane.realRange)}{range("Imaginary", "imaginaryRange", settings.complexPlane.imaginaryRange)}
            <button className="visualization-reset" onClick={() => { const fitted = fitComplex(ready); if (fitted) onChange(mode, fitted); }}>Fit to content</button>
            <button className="visualization-reset" onClick={() => onChange(mode, { realRange: [-10, 10], imaginaryRange: [-10, 10] })}>Reset view</button>
          </>}
          {mode === "graph3d" && <>{range("x", "xRange", settings.graph3d.xRange)}{range("y", "yRange", settings.graph3d.yRange)}{range("z", "zRange", settings.graph3d.zRange)}
            <button className="visualization-reset" onClick={() => { const fitted = fit3D(ready); if (fitted) onChange(mode, fitted); }}>Fit to content</button>
            <button className="visualization-reset" onClick={() => onChange(mode, { xRange: [-10, 10], yRange: [-10, 10], zRange: [-10, 10], camera: { rotation: [0.75, 0.6], zoom: 1, pan: [0, 0] } })}>Reset view</button>
          </>}
        </div>
        {!ready.length ? <div className="visualization-status">{group.some((plot) => !hidden[plot.id]) ? "Sampling plots…" : "All plots are hidden."}</div>
          : mode === "graph2d" ? <Graph2D plots={ready} settings={settings} />
            : mode === "complexPlane" ? <ComplexPlane plots={ready} settings={settings} />
              : <Graph3D plots={ready} settings={settings} onChange={onChange} />}
      </section>;
    })}
  </div>;
}

function fit2D(plots: SharedVisualizationPlot[]) {
  const x: number[] = [], y: number[] = [];
  for (const plot of plots) for (const series of plot.result?.series ?? []) {
    for (const point of series.points ?? []) { if (Number.isFinite(point[0])) x.push(point[0]); if (point[1] !== null && Number.isFinite(point[1])) y.push(point[1]); }
    if (series.kind === "implicit") { x.push(...(series.x ?? [])); y.push(...(series.y ?? [])); }
  }
  return x.length && y.length ? { xRange: paddedRange(x), yRange: paddedRange(y) } : null;
}

function fitComplex(plots: SharedVisualizationPlot[]) {
  const real = plots.flatMap((plot) => plot.result?.points?.map((point) => point.real) ?? []);
  const imaginary = plots.flatMap((plot) => plot.result?.points?.map((point) => point.imaginary) ?? []);
  return real.length && imaginary.length ? { realRange: paddedRange(real), imaginaryRange: paddedRange(imaginary) } : null;
}

function fit3D(plots: SharedVisualizationPlot[]) {
  const axes: [number[], number[], number[]] = [[], [], []];
  const add = (point: number[]) => point.forEach((value, index) => { if (index < 3 && Number.isFinite(value)) axes[index].push(value); });
  for (const plot of plots) {
    const result = plot.result;
    if (!result) continue;
    if (result.kind === "surface3d" || result.kind === "implicit3d") {
      axes[0].push(...(result.x ?? [])); axes[1].push(...(result.y ?? []));
      if (result.kind === "implicit3d" && Array.isArray(result.z)) axes[2].push(...result.z as number[]);
      else if (Array.isArray(result.z)) for (const row of result.z) if (Array.isArray(row)) for (const value of row) if (value !== null) axes[2].push(value);
    }
    for (const vector of result.vectors ?? []) add(result.kind === "field3d" ? vector.slice(0, 3) : vector);
    for (const point of result.curve ?? []) if (point.every((value) => value !== null)) add(point as number[]);
  }
  return axes.every((values) => values.length) ? { xRange: paddedRange(axes[0]), yRange: paddedRange(axes[1]), zRange: paddedRange(axes[2]) } : null;
}

function Graph2D({ plots, settings }: { plots: SharedVisualizationPlot[]; settings: VisualizationSettings }) {
  const saved = settings.graph2d;
  const [range, setRange] = useState({ x: saved.xRange, y: saved.yRange });
  const drag = useRef<{ x: number; y: number; range: typeof range } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; range: typeof range; x: number; y: number } | null>(null);
  useEffect(() => setRange({ x: saved.xRange, y: saved.yRange }), [saved.xRange[0], saved.xRange[1], saved.yRange[0], saved.yRange[1]]);
  const viewport = equalUnitRanges(range.x, range.y, 724, 234);
  const tx = (x: number) => 56 + (x - viewport.x[0]) / (viewport.x[1] - viewport.x[0]) * 724;
  const ty = (y: number) => 254 - (y - viewport.y[0]) / (viewport.y[1] - viewport.y[0]) * 234;
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * 800, py = (event.clientY - rect.top) / rect.height * 290;
    if (event.deltaX !== 0 && !event.ctrlKey) {
      setRange(panRanges(viewport.x, viewport.y, -event.deltaX / rect.width * 800, -event.deltaY / rect.height * 290, 724, 234));
      return;
    }
    const x = Math.max(0, Math.min(1, (px - 56) / 724)), y = Math.max(0, Math.min(1, (py - 20) / 234));
    const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.0015)));
    setRange(zoomRangesAt(viewport.x, viewport.y, x, y, factor, 724, 234));
  };
  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const midX = ((first.x + second.x) / 2 - rect.left) / rect.width * 800;
      const midY = ((first.y + second.y) / 2 - rect.top) / rect.height * 290;
      pinch.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), range: viewport,
        x: Math.max(0, Math.min(1, (midX - 56) / 724)), y: Math.max(0, Math.min(1, (midY - 20) / 234)) };
      drag.current = null;
    } else drag.current = { x: event.clientX, y: event.clientY, range: viewport };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      setRange(zoomRangesAt(pinch.current.range.x, pinch.current.range.y, pinch.current.x, pinch.current.y, pinch.current.distance / distance, 724, 234));
      return;
    }
    if (!drag.current) return;
    const start = drag.current, rect = event.currentTarget.getBoundingClientRect();
    setRange(panRanges(start.range.x, start.range.y, (event.clientX - start.x) / rect.width * 800, (event.clientY - start.y) / rect.height * 290, 724, 234));
  };
  const up = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const remaining = [...pointers.current.values()][0];
    drag.current = remaining ? { x: remaining.x, y: remaining.y, range: equalUnitRanges(range.x, range.y, 724, 234) } : null;
  };
  const vertical = Array.from({ length: 11 }, (_, i) => viewport.x[0] + (viewport.x[1] - viewport.x[0]) * i / 10);
  const horizontal = Array.from({ length: 9 }, (_, i) => viewport.y[0] + (viewport.y[1] - viewport.y[0]) * i / 8);
  return <svg className="graph2d-plot" viewBox="0 0 800 290" role="img" aria-label="Numerically sampled two-dimensional graph" onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    <defs><clipPath id="shared-graph2d-clip"><rect x="56" y="20" width="724" height="234" /></clipPath></defs>
    <rect x="56" y="20" width="724" height="234" fill="#11151b" />
    {vertical.map((v, i) => <g key={"x" + i}><line x1={tx(v)} x2={tx(v)} y1="20" y2="254" className="plot-grid" /><text x={tx(v)} y="273" className="plot-tick">{tick(v)}</text></g>)}
    {horizontal.map((v, i) => <g key={"y" + i}><line x1="56" x2="780" y1={ty(v)} y2={ty(v)} className="plot-grid" /><text x="48" y={ty(v) + 3} className="plot-tick" textAnchor="end">{tick(v)}</text></g>)}
    <line x1={tx(0)} x2={tx(0)} y1="20" y2="254" className="plot-axis" /><line x1="56" x2="780" y1={ty(0)} y2={ty(0)} className="plot-axis" />
    <g clipPath="url(#shared-graph2d-clip)">{plots.flatMap((plot, plotIndex) => (plot.result?.series ?? []).map((series, seriesIndex) => {
      const color = plot.color ?? sharedPlotColor(plot.settings, plotIndex);
      return series.kind === "function"
        ? <path key={`${plot.id}-${seriesIndex}`} d={makePath(series.points ?? [], tx, ty)} fill="none" stroke={color} strokeWidth="2" />
        : <g key={`${plot.id}-${seriesIndex}`}>{makeContours(series.x ?? [], series.y ?? [], series.values ?? []).map((line, n) => <line key={n} x1={tx(line[0][0])} y1={ty(line[0][1])} x2={tx(line[1][0])} y2={ty(line[1][1])} stroke={color} strokeWidth="1.7" />)}</g>;
    }))}</g>
  </svg>;
}

function makePath(points: Array<[number, number | null]>, tx: (x: number) => number, ty: (y: number) => number) {
  let path = "", draw = false;
  for (const [x, y] of points) { if (y === null) { draw = false; continue; } path += (draw ? "L" : "M") + tx(x).toFixed(2) + "," + ty(y).toFixed(2) + " "; draw = true; }
  return path;
}

function makeContours(xs: number[], ys: number[], values: Array<Array<number | null>>) {
  const output: Array<[[number, number], [number, number]]> = [], edges = [[0,1],[1,2],[2,3],[3,0]];
  for (let y=0;y<ys.length-1;y++) for(let x=0;x<xs.length-1;x++) {
    const corners:Array<[number,number,number|null|undefined]>=[[xs[x],ys[y],values[y]?.[x]],[xs[x+1],ys[y],values[y]?.[x+1]],[xs[x+1],ys[y+1],values[y+1]?.[x+1]],[xs[x],ys[y+1],values[y+1]?.[x]]];
    if(corners.some((p)=>p[2]===null||p[2]===undefined))continue;
    const hits:Array<[number,number]>=[];
    for(const [a,b] of edges){const va=corners[a][2] as number,vb=corners[b][2] as number;if((va<0)===(vb<0))continue;const t=va/(va-vb);hits.push([corners[a][0]+t*(corners[b][0]-corners[a][0]),corners[a][1]+t*(corners[b][1]-corners[a][1])]);}
    for(let i=0;i+1<hits.length;i+=2)output.push([hits[i],hits[i+1]]);
  }
  return output;
}

function paddedRange(values:number[]):[number,number]{const minimum=Math.min(...values),maximum=Math.max(...values),span=Math.max(maximum-minimum,1);return[minimum-span*.1,maximum+span*.1];}

function ComplexPlane({ plots, settings }: { plots: SharedVisualizationPlot[]; settings: VisualizationSettings }) {
  const cfg = settings.complexPlane;
  const [range, setRange] = useState({ x: cfg.realRange, y: cfg.imaginaryRange });
  const drag = useRef<{ x: number; y: number; range: typeof range } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; range: typeof range; x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  useEffect(() => setRange({ x: cfg.realRange, y: cfg.imaginaryRange }), [cfg.realRange[0], cfg.realRange[1], cfg.imaginaryRange[0], cfg.imaginaryRange[1]]);
  const viewport = equalUnitRanges(range.x, range.y, 728, 234);
  const tx = (x: number) => 52 + (x - viewport.x[0]) / (viewport.x[1] - viewport.x[0]) * 728;
  const ty = (y: number) => 254 - (y - viewport.y[0]) / (viewport.y[1] - viewport.y[0]) * 234;
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * 800, py = (event.clientY - rect.top) / rect.height * 290;
    if (event.deltaX !== 0 && !event.ctrlKey) {
      setRange(panRanges(viewport.x, viewport.y, -event.deltaX / rect.width * 800, -event.deltaY / rect.height * 290, 728, 234));
      return;
    }
    const x = Math.max(0, Math.min(1, (px - 52) / 728)), y = Math.max(0, Math.min(1, (py - 20) / 234));
    const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.0015)));
    setRange(zoomRangesAt(viewport.x, viewport.y, x, y, factor, 728, 234));
  };
  const down = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const midX = ((first.x + second.x) / 2 - rect.left) / rect.width * 800;
      const midY = ((first.y + second.y) / 2 - rect.top) / rect.height * 290;
      pinch.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), range: viewport,
        x: Math.max(0, Math.min(1, (midX - 52) / 728)), y: Math.max(0, Math.min(1, (midY - 20) / 234)) };
      drag.current = null;
    } else drag.current = { x: event.clientX, y: event.clientY, range: viewport };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      setRange(zoomRangesAt(pinch.current.range.x, pinch.current.range.y, pinch.current.x, pinch.current.y, pinch.current.distance / distance, 728, 234));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (!drag.current) {
      const px = (event.clientX - rect.left) / rect.width * 800, py = (event.clientY - rect.top) / rect.height * 290;
      if (px >= 52 && px <= 780 && py >= 20 && py <= 254) setCursor([viewport.x[0] + (px - 52) / 728 * (viewport.x[1] - viewport.x[0]), viewport.y[1] - (py - 20) / 234 * (viewport.y[1] - viewport.y[0])]);
      else setCursor(null);
      return;
    }
    const start = drag.current;
    setRange(panRanges(start.range.x, start.range.y, (event.clientX - start.x) / rect.width * 800, (event.clientY - start.y) / rect.height * 290, 728, 234));
  };
  const up = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const remaining = [...pointers.current.values()][0];
    drag.current = remaining ? { x: remaining.x, y: remaining.y, range: equalUnitRanges(range.x, range.y, 728, 234) } : null;
  };
  return <svg className="graph2d-plot" viewBox="0 0 800 290" role="img" aria-label="Shared complex plane" onWheel={wheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    <rect x="52" y="20" width="728" height="234" fill="#11151b" />
    {Array.from({ length: 11 }, (_, i) => { const x = viewport.x[0] + (viewport.x[1] - viewport.x[0]) * i / 10; return <g key={`x${i}`}><line x1={52 + 72.8 * i} x2={52 + 72.8 * i} y1="20" y2="254" className="plot-grid" /><text x={52 + 72.8 * i} y="273" className="plot-tick">{tick(x)}</text></g>; })}
    {Array.from({ length: 9 }, (_, i) => { const y = viewport.y[1] - (viewport.y[1] - viewport.y[0]) * i / 8; return <g key={`y${i}`}><line x1="52" x2="780" y1={20 + 29.25 * i} y2={20 + 29.25 * i} className="plot-grid" /><text x="48" y={23 + 29.25 * i} className="plot-tick" textAnchor="end">{tick(y)}</text></g>; })}
    <line x1={tx(0)} x2={tx(0)} y1="20" y2="254" className="plot-axis" /><line x1="52" x2="780" y1={ty(0)} y2={ty(0)} className="plot-axis" /><text x="770" y={ty(0) - 5} className="plot-axis-label">Re</text><text x={tx(0) + 6} y="30" className="plot-axis-label">Im</text>
    {plots.flatMap((plot, plotIndex) => plot.result?.points?.filter((point) => point.real >= viewport.x[0] && point.real <= viewport.x[1] && point.imaginary >= viewport.y[0] && point.imaginary <= viewport.y[1]).map((point, index) => <g key={`${plot.id}-${index}`}><circle cx={tx(point.real)} cy={ty(point.imaginary)} r="5" fill={plot.color ?? sharedPlotColor(plot.settings, plotIndex)} /><text x={tx(point.real) + 8} y={ty(point.imaginary) - 7} className="complex-point-label">{point.exact}</text></g>) ?? [])}
    {cursor && <text x="64" y="289" className="plot-axis-label">Re {cursor[0].toPrecision(5)} · Im {cursor[1].toPrecision(5)}</text>}
  </svg>;
}

type P3 = [number, number, number];
type Tri = [P3, P3, P3];
type ColoredTriangle = { points: Tri; color: string };

function Graph3D({ plots, settings, onChange }: { plots: SharedVisualizationPlot[]; settings: VisualizationSettings; onChange: Props["onChange"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cfg = settings.graph3d;
  const drag = useRef<{ x: number; y: number; rotation: [number, number]; pan: [number, number]; panMode: boolean } | null>(null);
  const [camera, setCamera] = useState(cfg.camera);
  useEffect(() => setCamera(cfg.camera), [cfg.camera.rotation[0], cfg.camera.rotation[1], cfg.camera.zoom, cfg.camera.pan[0], cfg.camera.pan[1]]);
  const dataKey = plotSignature(plots);
  const triangles = useMemo(() => plots.flatMap((plot, index) => {
    if (!plot.result) return [];
    let mesh = meshCache.get(plot.result);
    if (!mesh) {
      mesh = plot.result.kind === "implicit3d" ? implicitTriangles(plot.result) : plot.result.kind === "surface3d" ? surfaceTriangles(plot.result) : [];
      meshCache.set(plot.result, mesh);
    }
    const color = plot.color ?? sharedPlotColor(plot.settings, index);
    return mesh.map((points) => ({ points, color }));
  }), [dataKey]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => drawCanvas(element, triangles, plots, { ...cfg, camera });
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, [triangles, dataKey, cfg, camera]);

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, rotation: [...camera.rotation], pan: [...camera.pan], panMode: event.shiftKey || event.button === 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = drag.current;
    if (!start) return;
    if (start.panMode || event.shiftKey || event.buttons === 4) {
      const rect = event.currentTarget.getBoundingClientRect();
      setCamera({ ...camera, pan: [
        Math.max(-4, Math.min(4, start.pan[0] + (event.clientX - start.x) / rect.width * 2)),
        Math.max(-4, Math.min(4, start.pan[1] - (event.clientY - start.y) / rect.height * 2)),
      ] });
    } else {
      setCamera({ ...camera, rotation: [
        start.rotation[0] + (event.clientX - start.x) * 0.009,
        Math.max(0.1, Math.min(3.04, start.rotation[1] + (event.clientY - start.y) * 0.009)),
      ] });
    }
  };
  const pointerUp = () => {
    if (drag.current) onChange("graph3d", { camera });
    drag.current = null;
  };
  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const next = { ...camera, zoom: Math.max(0.25, Math.min(8, camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1))) };
    setCamera(next);
    onChange("graph3d", { camera: next });
  };
  const label = "Combined 3D scene";
  return <div className="graph3d-frame">
    <span className="graph3d-kind">{label}</span>
    <canvas ref={canvas} className="graph3d-canvas" role="img" aria-label={"Interactive numerical 3D " + label.toLowerCase()}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel} />
  </div>;
}

function surfaceTriangles(result: VisualizationResult): Tri[] {
  const xs = result.x ?? [], ys = result.y ?? [];
  const rows = Array.isArray(result.z?.[0]) ? result.z as Array<Array<number | null>> : [];
  const triangles: Tri[] = [];
  for (let y = 0; y < ys.length - 1; y++) for (let x = 0; x < xs.length - 1; x++) {
    const a = rows[y]?.[x], b = rows[y]?.[x + 1], c = rows[y + 1]?.[x + 1], d = rows[y + 1]?.[x];
    if ([a, b, c, d].some((value) => value === null || value === undefined)) continue;
    const points: P3[] = [
      [xs[x], ys[y], a as number], [xs[x + 1], ys[y], b as number],
      [xs[x + 1], ys[y + 1], c as number], [xs[x], ys[y + 1], d as number],
    ];
    triangles.push([points[0], points[1], points[2]], [points[0], points[2], points[3]]);
  }
  return triangles;
}

function implicitTriangles(result: VisualizationResult): Tri[] {
  const xs = result.x ?? [], ys = result.y ?? [], zs = Array.isArray(result.z) ? result.z as number[] : [], values = result.values ?? [];
  const corners = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  const tetrahedra = [[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]], edges = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  const output: Tri[] = [];
  for (let x=0;x<xs.length-1;x++) for(let y=0;y<ys.length-1;y++) for(let z=0;z<zs.length-1;z++) {
    const cube = corners.map(([dx,dy,dz]) => ({ p:[xs[x+dx],ys[y+dy],zs[z+dz]] as P3, v:values[x+dx]?.[y+dy]?.[z+dz] ?? null }));
    if(cube.some(point=>point.v===null)) continue;
    for(const tetra of tetrahedra) {
      const hits:P3[]=[];
      for(const [a,b] of edges) {
        const p=cube[tetra[a]],q=cube[tetra[b]],pv=p.v as number,qv=q.v as number;
        if((pv<0)===(qv<0)) continue;
        const t=pv/(pv-qv);
        hits.push([0,1,2].map(n=>p.p[n]+t*(q.p[n]-p.p[n])) as P3);
      }
      if(hits.length===3) output.push([hits[0],hits[1],hits[2]]);
      else if(hits.length===4) output.push([hits[0],hits[1],hits[2]],[hits[0],hits[2],hits[3]]);
      if(output.length>=24000) return output;
    }
  }
  return output;
}

function drawCanvas(canvas: HTMLCanvasElement, triangles: ColoredTriangle[], plots: SharedVisualizationPlot[], cfg: VisualizationSettings["graph3d"]) {
  const rect=canvas.getBoundingClientRect(),width=Math.max(1,rect.width),height=Math.max(1,rect.height),ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=width*ratio;canvas.height=height*ratio;
  const context=canvas.getContext("2d");if(!context)return;
  context.scale(ratio,ratio);context.fillStyle="#11151b";context.fillRect(0,0,width,height);
  const [xmin,xmax]=cfg.xRange,[ymin,ymax]=cfg.yRange,[zmin,zmax]=cfg.zRange;
  const theta=cfg.camera.rotation[0],phi=cfg.camera.rotation[1],scale=Math.min(width,height)*0.37*cfg.camera.zoom;
  const project=(point:P3)=>{
    const x=(point[0]-(xmin+xmax)/2)/((xmax-xmin)/2),y=(point[1]-(ymin+ymax)/2)/((ymax-ymin)/2),z=(point[2]-(zmin+zmax)/2)/((zmax-zmin)/2);
    const rx=x*Math.cos(theta)-z*Math.sin(theta),rz=x*Math.sin(theta)+z*Math.cos(theta),ry=y*Math.cos(phi)-rz*Math.sin(phi),depth=y*Math.sin(phi)+rz*Math.cos(phi);
    return [width/2+cfg.camera.pan[0]*width/2+rx*scale,height/2-cfg.camera.pan[1]*height/2-ry*scale,depth] as const;
  };
  for(let step=0;step<=8;step++){
    const value=step/4-1;
    for(const [from,to] of [[[-1+value,-1,-1],[-1+value,1,-1]],[[-1,-1+value,-1],[1,-1+value,-1]]] as [P3,P3][]){
      const a=project(from),b=project(to);context.strokeStyle="#303743";context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.stroke();
    }
  }
  for(const [from,to] of [[[-1,0,0],[1,0,0]],[[0,-1,0],[0,1,0]],[[0,0,-1],[0,0,1]]] as [P3,P3][]){
    const a=project(from),b=project(to);context.strokeStyle="#687382";context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.stroke();
  }
  const sorted=triangles.map(({points,color})=>({points:points.map(project),depth:points.reduce((sum,point)=>sum+project(point)[2],0)/3,color})).sort((a,b)=>a.depth-b.depth);
  for(const triangle of sorted){
    const [a,b,c]=triangle.points;context.globalAlpha=Math.max(0.2,Math.min(0.82,0.48+triangle.depth*0.13));
    context.fillStyle=triangle.color;context.strokeStyle=triangle.color;context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.lineTo(c[0],c[1]);context.closePath();context.fill();context.lineWidth=0.35;context.stroke();
  }
  context.globalAlpha=1;context.fillStyle="#a0a9b5";context.font="11px system-ui";
  const labels:Array<[string,P3]>=[["x",[1.08,0,0]],["y",[0,1.08,0]],["z",[0,0,1.08]]];
  for(const [label,point] of labels){const p=project(point);context.fillText(label,p[0],p[1]);}
  const arrow=(from:P3,to:P3,label:string|undefined,color:string)=>{
    const a=project(from),b=project(to),angle=Math.atan2(b[1]-a[1],b[0]-a[0]);
    context.strokeStyle=color;context.fillStyle=color;context.lineWidth=1.7;context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.stroke();
    context.beginPath();context.moveTo(b[0],b[1]);context.lineTo(b[0]-8*Math.cos(angle-0.45),b[1]-8*Math.sin(angle-0.45));context.lineTo(b[0]-8*Math.cos(angle+0.45),b[1]-8*Math.sin(angle+0.45));context.closePath();context.fill();
    if(label)context.fillText(label,b[0]+5,b[1]-5);
  };
  for (const [plotIndex, plot] of plots.entries()) {
    const result = plot.result;
    if (!result) continue;
    const color = plot.color ?? sharedPlotColor(plot.settings, plotIndex);
    if(result.kind==="vector3d") for(const [index,vector] of (result.vectors??[]).entries()) arrow([0,0,0],[vector[0],vector[1],vector[2]],(result.exactVectors?.[index]??[]).join(", "),color);
    if(result.kind==="field3d") for(const vector of result.vectors??[]){
      const magnitude=Math.hypot(vector[3],vector[4],vector[5]),factor=0.12*Math.min(xmax-xmin,ymax-ymin,zmax-zmin)/Math.max(magnitude,1);
      arrow([vector[0],vector[1],vector[2]],[vector[0]+vector[3]*factor,vector[1]+vector[4]*factor,vector[2]+vector[5]*factor],undefined,color);
    }
    if(result.kind==="curve3d"){
      let previous:P3|null=null;
      for(const point of result.curve??[]){
        if(point.some(value=>value===null)){previous=null;continue;}
        const current=point as P3;
        if(previous){const a=project(previous),b=project(current);context.strokeStyle=color;context.lineWidth=2;context.beginPath();context.moveTo(a[0],a[1]);context.lineTo(b[0],b[1]);context.stroke();}
        previous=current;
      }
    }
  }
}

function tick(value:number){return Number(value.toPrecision(3)).toString();}
