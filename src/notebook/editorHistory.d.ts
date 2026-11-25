export class DocumentHistory<T> {
  constructor(limit?: number);
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  record(document: T): void;
  undo(current: T): T | null;
  redo(current: T): T | null;
  clear(): void;
}
