export async function exportLatest(id, activeId, destination, flushActiveSave, exportFile) {
  if (!destination) return null;
  if (activeId === id && !await flushActiveSave()) {
    throw new Error("The latest notebook changes could not be saved, so the export was cancelled.");
  }
  return exportFile(id, destination);
}
