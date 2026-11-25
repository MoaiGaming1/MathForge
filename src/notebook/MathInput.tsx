import { useEffect, useRef, useState } from "react";
import "mathlive";
import "mathlive/fonts.css";
import type { MathfieldElement } from "mathlive";
import { latexToExpression, sourceToMathLiveLatex } from "./mathNotation.js";
import { isCompleteEngineSource } from "./displayModes.js";

export function MathInput({ id, source, suggestions = [], onChange, onMove, onKeyDown, allowVisualizationSyntax = false }: {
  id: string;
  source: string;
  suggestions?: string[];
  onChange: (source: string) => void;
  onMove: (direction: "upward" | "downward") => void;
  onKeyDown: (event: KeyboardEvent) => void;
  allowVisualizationSyntax?: boolean;
}) {
  const [invalidDraft, setInvalidDraft] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const sourceRef = useRef(source);
  const changeRef = useRef(onChange);
  const moveRef = useRef(onMove);
  const keyRef = useRef(onKeyDown);
  const visualizationSyntaxRef = useRef(allowVisualizationSyntax);
  changeRef.current = onChange;
  moveRef.current = onMove;
  keyRef.current = onKeyDown;
  visualizationSyntaxRef.current = allowVisualizationSyntax;

  useEffect(() => {
    if (!host.current) return;
    const mathfield = document.createElement("math-field") as MathfieldElement;
    mathfield.id = id;
    mathfield.setAttribute("smart-mode", "false");
    mathfield.setAttribute("smart-superscript", "true");
    mathfield.setAttribute("math-virtual-keyboard-policy", "auto");
    mathfield.setAttribute("aria-label", "Mathematical expression");
    const initialLatex = sourceToMathLiveLatex(sourceRef.current);
    mathfield.setValue(initialLatex, { silenceNotifications: true });
    const onInput = () => {
      const converted = latexToExpression(mathfield.value);
      const content = converted ?? mathfield.value;
      setInvalidDraft(converted === null && !visualizationSyntaxRef.current && !isCompleteEngineSource(mathfield.value));
      const token = /([A-Za-z_]\w*)$/.exec(mathfield.value)?.[1] ?? "";
      setSuggestionQuery(token.length > 0 ? token : "");
      sourceRef.current = content;
      changeRef.current(content);
    };
    const onMoveOut = (event: Event) => {
      const direction = (event as CustomEvent<{ direction: string }>).detail.direction;
      if (direction === "upward" || direction === "downward") {
        event.preventDefault();
        moveRef.current(direction);
      }
    };
    const onKey = (event: Event) => keyRef.current(event as KeyboardEvent);
    mathfield.addEventListener("input", onInput);
    mathfield.addEventListener("move-out", onMoveOut);
    mathfield.addEventListener("keydown", onKey);
    host.current.replaceChildren(mathfield);
    field.current = mathfield;
    return () => {
      mathfield.removeEventListener("input", onInput);
      mathfield.removeEventListener("move-out", onMoveOut);
      mathfield.removeEventListener("keydown", onKey);
      field.current = null;
      mathfield.remove();
    };
  }, [id]);

  useEffect(() => {
    if (field.current && source !== sourceRef.current) {
      const latex = sourceToMathLiveLatex(source);
      field.current.setValue(latex, { silenceNotifications: true });
      sourceRef.current = source;
    }
  }, [source]);

  const matchingSuggestions = suggestionQuery.length > 0
    ? suggestions.filter((suggestion) => suggestion.toLowerCase().startsWith(suggestionQuery.toLowerCase())).slice(0, 7)
    : [];
  const applySuggestion = (suggestion: string) => {
    const mathfield = field.current;
    if (!mathfield) return;
    const next = mathfield.value.replace(/[A-Za-z_]\w*$/, suggestion);
    mathfield.setValue(next, { silenceNotifications: true });
    mathfield.position = mathfield.lastOffset;
    setSuggestionQuery("");
    const converted = latexToExpression(mathfield.value);
    const content = converted ?? mathfield.value;
    setInvalidDraft(converted === null && !visualizationSyntaxRef.current && !isCompleteEngineSource(mathfield.value));
    sourceRef.current = content;
    changeRef.current(content);
  };

  return <div className="math-input-wrap"><div className="math-input-host" ref={host} />{matchingSuggestions.length > 0 && <div className="math-suggestions" role="listbox" aria-label="Mathematical suggestions">{matchingSuggestions.map((suggestion) => <button key={suggestion} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => applySuggestion(suggestion)}>{suggestion}</button>)}</div>}{invalidDraft && !allowVisualizationSyntax && <span className="math-draft-hint" role="status">Finish the expression to calculate</span>}</div>;
}
