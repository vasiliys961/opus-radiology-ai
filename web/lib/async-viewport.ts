/** Serialize GPU activation; superseded requests must never resurrect a hidden viewport. */
export function createAsyncViewportToggle(
  activate: (isCurrent: () => boolean) => Promise<void>,
  deactivate: () => void,
) {
  let revision = 0;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    setActive(enabled: boolean): Promise<boolean> {
      const token = ++revision;
      const isCurrent = () => !disposed && revision === token;
      const task = queue.then(async () => {
        if (!isCurrent()) return false;
        if (!enabled) { deactivate(); return false; }
        try { await activate(isCurrent); }
        catch (cause) {
          deactivate();
          if (isCurrent()) throw cause;
          return false;
        }
        if (!isCurrent()) { deactivate(); return false; }
        return true;
      });
      queue = task.catch(() => {});
      return task;
    },
    dispose() { disposed = true; revision++; deactivate(); },
  };
}
