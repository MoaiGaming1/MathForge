export function exportLatest(
  id: string,
  activeId: string | undefined,
  destination: string | null,
  flushActiveSave: () => Promise<boolean>,
  exportFile: (id: string, destination: string) => Promise<string>,
): Promise<string | null>;
