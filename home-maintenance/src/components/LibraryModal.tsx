import { useEffect, useMemo, useState } from "react";
import { describeInterval, nextMonthStart } from "../../shared/dates";
import type { Template } from "../../shared/library";
import type { TaskView } from "../../shared/types";
import { api } from "../api";
import { Modal } from "./Modal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function LibraryModal({ existing, today, onClose, onSaved }: { existing: TaskView[]; today: string; onClose: () => void; onSaved: () => void }) {
  const [library, setLibrary] = useState<Template[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const have = useMemo(() => new Set(existing.map((t) => t.name.toLowerCase())), [existing]);

  useEffect(() => {
    api.library().then(setLibrary, (e) => setError(e.message));
  }, []);

  const areas = [...new Set(library.map((t) => t.area))];
  const toggle = (i: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  async function add() {
    try {
      await api.createTasks(
        [...picked].map((i) => {
          const t = library[i];
          return { name: t.name, area: t.area, notes: t.notes, every: t.every, unit: t.unit, leadDays: 7, startDate: t.month ? nextMonthStart(today, t.month) : today };
        }),
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Add common tasks" onClose={onClose} wide>
      <p className="hint">Pick the ones that apply to your home. Seasonal tasks start in the month shown; the rest start today. You can edit any of them afterwards.</p>
      <div className="library">
        {areas.map((area) => (
          <section key={area}>
            <h3>{area}</h3>
            {library.map((t, i) =>
              t.area !== area ? null : (
                <label key={t.name} className={`pick${have.has(t.name.toLowerCase()) ? " have" : ""}`}>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} disabled={have.has(t.name.toLowerCase())} />
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {describeInterval(t.every, t.unit)}
                      {t.month ? ` · from ${MONTHS[t.month - 1]}` : ""}
                      {have.has(t.name.toLowerCase()) ? " · already added" : ""}
                    </small>
                  </span>
                </label>
              ),
            )}
          </section>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <footer>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={picked.size === 0} onClick={add}>
          Add {picked.size || ""} task{picked.size === 1 ? "" : "s"}
        </button>
      </footer>
    </Modal>
  );
}
