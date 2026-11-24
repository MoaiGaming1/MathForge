import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { checkEngine, simplify } from "./notebook/engine";
import type { EngineStatus, HealthResult, SimplifyResult } from "./types/engine";

const starterExpression = "(x^2 - 1) / (x - 1)";

export default function App() {
  const [status, setStatus] = useState<EngineStatus>("checking");
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [expression, setExpression] = useState(starterExpression);
  const [result, setResult] = useState<SimplifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extraCell, setExtraCell] = useState(false);
  const calculationRevision = useRef(0);

  useEffect(() => {
    checkEngine().then((value) => {
      setHealth(value);
      setStatus(value ? "available" : "preview");
    }).catch(() => setStatus("unavailable"));
  }, []);

  useEffect(() => {
    if (!isTauri() || status !== "available") return;
    const revision = ++calculationRevision.current;
    const timer = window.setTimeout(() => {
      const current = expression.trim();
      if (!current) { setResult(null); setError(null); return; }
      setError(null);
      simplify(current).then((value) => {
        if (revision === calculationRevision.current) setResult(value);
      }).catch((cause: unknown) => {
        if (revision !== calculationRevision.current) return;
        setError(cause instanceof Error ? cause.message : "Calculation failed.");
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [expression, status]);

  const badge = status === "available" ? "Engine ready" : status === "checking" ? "Connecting…" : status === "preview" ? "UI preview" : "Engine unavailable";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">M</div><span>MathForge</span></div>
        <div className="side-label">WORKSPACE</div>
        <button className="nav-item selected"><span className="nav-icon">▤</span> Notebook</button>
        <button className="nav-item muted"><span className="nav-icon">⌕</span> Search</button>
        <div className="sidebar-bottom"><div className="side-label">LOCAL LIBRARY</div><div className="library-card"><span className="file-icon">∑</span><span><strong>Untitled notebook</strong><small>Edited just now</small></span><span className="more">···</span></div><button className="new-notebook">＋ <span>New notebook</span></button></div>
        <div className="profile"><div className="avatar">M</div><span><strong>Local workspace</strong><small>Stored on this device</small></span><span className="more">···</span></div>
      </aside>

      <section className="content">
        <header className="topbar"><div className="breadcrumbs">Notebooks <span>/</span> <strong>Untitled notebook</strong></div><div className="top-actions"><span className={`status ${status}`}><i />{badge}</span><button className="icon-button" aria-label="More options">···</button></div></header>
        <div className="notebook">
          <div className="notebook-heading"><div className="eyebrow">NOTEBOOK <span>·</span> NOV 24, 2026</div><h1>Untitled notebook</h1><p>A quiet place to think through the math.</p></div>
          <div className="welcome"><div className="welcome-symbol">∫</div><div><h2>Start with a question.</h2><p>Write an expression below. MathForge will keep up as you work.</p></div></div>

          <article className="cell"><div className="cell-gutter"><span className="cell-number">1</span><span className="cell-kind">ƒx</span></div><div className="cell-body"><div className="cell-label"><span>MATHEMATICS</span><span className="cell-state">{status === "available" ? "AUTO · 450 MS" : "SYMBOLIC"}</span></div><label className="sr-only" htmlFor="expression">Mathematical expression</label><textarea id="expression" spellCheck={false} value={expression} onChange={(event) => setExpression(event.target.value)} rows={1} />
            <div className="output"><div className="output-label">RESULT <span>{health?.version ?? "EXACT"}</span></div>{error ? <p className="error">{error}</p> : result ? <><div className="result-math">{result.exact}</div><div className="result-note">Simplified exactly with SymPy</div></> : <><div className="result-math">x + 1</div><div className="result-note">Example preview · Connect the engine to calculate</div></>}</div>
          </div></article>

          {extraCell && <article className="cell secondary-cell"><div className="cell-gutter"><span className="cell-number">2</span><span className="cell-kind">¶</span></div><div className="cell-body"><div className="cell-label"><span>MATHEMATICS</span><span className="cell-state">NEW CELL</span></div><textarea aria-label="New mathematical cell" placeholder="Type an expression…" rows={1} /></div></article>}
          <button className="add-cell" onClick={() => setExtraCell(true)}><span>＋</span> Add a cell</button>
          <div className="keyboard-hint">Changes calculate automatically <kbd>LOCAL</kbd></div>
        </div>
        <footer className="footer"><span>{status === "available" ? `Python engine ${health?.version ?? ""}` : "MathForge · Local-first mathematics"}</span><span><i className="privacy-dot" /> Your work stays on this device</span></footer>
      </section>
    </main>
  );
}
