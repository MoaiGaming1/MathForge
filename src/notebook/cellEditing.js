function normalize(cells) {
  return cells.map((cell, order) => ({ ...cell, order }));
}

export function duplicateCell(cells, cellId, makeId) {
  const index = cells.findIndex((cell) => cell.id === cellId);
  if (index < 0) return cells;
  const cell = cells[index];
  const copy = { ...cell, id: makeId(), result: cell.result ? { ...cell.result } : null };
  const next = [...cells];
  next.splice(index + 1, 0, copy);
  return normalize(next);
}

export function moveCell(cells, cellId, direction) {
  const index = cells.findIndex((cell) => cell.id === cellId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= cells.length) return cells;
  const next = [...cells];
  [next[index], next[destination]] = [next[destination], next[index]];
  return normalize(next);
}

export function deleteCell(cells, cellId) {
  return normalize(cells.filter((cell) => cell.id !== cellId));
}
