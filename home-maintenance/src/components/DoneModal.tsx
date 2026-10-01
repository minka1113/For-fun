import { type FormEvent, useState } from "react";
import type { LogEntry, TaskView } from "../../shared/types";
import { api } from "../api";
import { Modal } from "./Modal";

/** Logs a completion, or edits an existing log entry. */
export function DoneModal({
  task,
  entry,
  today,
  onClose,
  onSaved,
}: {
  task?: TaskView;
  entry?: LogEntry;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(entry?.date ?? today);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [cost, setCost] = useState(entry?.cost == null ? "" : String(entry.cost));
  const [vendor, setVendor] = useState(entry?.vendor ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const input = { date, notes, vendor, cost: cost.trim() === "" ? null : Number(cost) };
    try {
      if (entry) await api.updateLog(entry.id, input);
      else if (task) await api.complete(task.id, input);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !confirm("Delete this history entry?")) return;
    await api.deleteLog(entry.id);
    onSaved();
  }

  return (
    <Modal title={entry ? `Edit: ${entry.taskName}` : `Done: ${task?.name}`} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <div className="row">
          <label>
            Date done
            <input type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Cost
            <input type="number" min={0} step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
          </label>
        </div>
        <label>
          Done by / vendor
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Leave blank if you did it yourself" />
        </label>
        <label>
          Notes
          <textarea autoFocus rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was done, parts used, anything to watch next time" />
        </label>
        {task && !entry && <p className="hint">The next one will be due {task.every} {task.unit}{task.every === 1 ? "" : "s"} after this date.</p>}
        {error && <p className="error">{error}</p>}
        <footer>
          {entry && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {entry ? "Save" : "Mark done"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
