// A probe event may arrive before the IPC start promise resolves. Track only
// the current selection/operation, not a global list of historical probe IDs.
export function createTestFlight() {
  let current = null;
  return {
    begin(selection) { current = {...selection, operation_id:null, completed:false, early:new Map()}; return current; },
    accept(proof) {
      if (!current || current.completed || current.config_version !== proof.config_version || current.kind !== proof.kind || current.provider_id !== proof.provider_id || current.model_ref !== proof.model_ref || (current.operation_id && current.operation_id !== proof.operation_id)) return null;
      if (!current.operation_id) {
        // Wait for the authoritative operation ID, even if an old same-model
        // probe event happens to arrive while a new start promise is pending.
        if(current.early.size < 4)current.early.set(proof.operation_id,proof);
        return null;
      }
      current.completed = true;
      return proof;
    },
    settle(token, run) {
      if (current !== token) return null;
      current.operation_id = run.operation_id;
      const proof=current.early.get(run.operation_id)||null;
      current.early.clear();current.completed=Boolean(proof);
      return {running:!proof,proof};
    },
    clear() { current = null; },
  };
}
