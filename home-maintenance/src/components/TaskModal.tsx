import { type FormEvent, useState } from "react";
import { AREAS, type TaskInput, type TaskView, UNITS, type Unit } from "../../shared/types";
import { api } from "../api";
import { Modal } from "./Modal";

export function TaskModal({ task, today, onClose, onSaved }: { task: TaskView | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TaskInput>(
    task
      ? { name: task.name, area: task.area, notes: task.notes, every: task.every, unit: task.unit, startDate: task.startDate, leadDays: task.leadDays }
      : { name: "", area: "Other", notes: "", every: 1, unit: "year", startDate: today, leadDays: 7 },
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (task) await api.updateTask(task.id, form);
      else await api.createTasks([form]);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !confirm(`Delete “${task.name}”? Its history is kept.`)) return;
    await api.deleteTask(task.id);
    onSaved();
  }

  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label>
          Task
          <input autoFocus required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Flush water heater" />
        </label>
        <label>
          Area
          <select value={form.area} onChange={(e) => set("area", e.target.value)}>
            {[...new Set([...AREAS, form.area])].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <div className="row">
          <label>
            Repeat every
            <input type="number" min={1} max={1000} required value={form.every} onChange={(e) => set("every", Number(e.target.value))} />
          </label>
          <label>
            &nbsp;
            <select value={form.unit} onChange={(e) => set("unit", e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                  {form.every === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label>
            {task?.lastDone ? "First due (before it was done)" : "First due"}
            <input type="date" required value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </label>
          <label>
            Remind me (days before)
            <input type="number" min={0} max={365} required value={form.leadDays} onChange={(e) => set("leadDays", Number(e.target.value))} />
          </label>
        </div>
        <label>
          Notes
          <textarea rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Filter size, part numbers, who to call…" />
        </label>
        {task && (
          <label className="check">
            <input type="checkbox" checked={task.archived} onChange={async (e) => (await api.updateTask(task.id, { archived: e.target.checked }), onSaved())} />
            Paused (hidden from the dashboard and calendar)
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <footer>
          {task && (
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save
          </button>
        </footer>
      </form>
    </Modal>
  );
}
