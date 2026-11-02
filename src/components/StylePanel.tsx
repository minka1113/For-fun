import type { DraftStyle } from "../../shared/types";
import type { RuleRow } from "../lib/style";

interface Props {
  rows: RuleRow[];
  styles: DraftStyle[];
  /** The style whose rules this draft is checked against. */
  checkStyleId: string;
  /** The style the draft was written in. */
  ownStyleId: string;
  /** True when the draft's own style was deleted. */
  ownStyleMissing: boolean;
  onChangeCheckStyle: (id: string) => void;
  checking: boolean;
  error: string | null;
  checkedAt?: number;
  stale: boolean;
  activeViolation: string | null;
  onCheck: () => void;
  onEditRules: () => void;
  onSelect: (violationId: string) => void;
  onApply: (violationId: string) => void;
  onDismiss: (violationId: string) => void;
}

const STATUS_LABEL = { pass: "✓", fail: "✕", recheck: "↻", unchecked: "–" } as const;

export function StylePanel(props: Props) {
  const { rows } = props;
  const needsClaude = rows.some((r) => r.checkedBy === "claude");

  return (
    <div className="style-panel">
      {props.ownStyleMissing && (
        <p className="ruleset-notice">The style this draft was written in has been deleted. Pick a style below to check against.</p>
      )}
      <div className="style-head">
        <label className="toggle">
          Check against:
          <select value={props.checkStyleId} onChange={(e) => props.onChangeCheckStyle(e.target.value)} aria-label="Style rules to check against">
            {props.styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === props.ownStyleId ? " (this draft's style)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="link" onClick={props.onEditRules}>Edit rules</button>
      </div>
      <div className="style-head">
        <div className="muted small">
          {props.checkedAt ? `Last checked ${new Date(props.checkedAt).toLocaleString()}` : "Not checked yet"}
          {props.stale && <span className="warn-text"> · the draft changed since, so re-check to confirm</span>}
        </div>
        <div className="toolbar">
          {needsClaude && (
            <button className="primary" disabled={props.checking} onClick={props.onCheck}>
              {props.checking ? "Checking…" : props.checkedAt ? "Re-check style" : "Check style"}
            </button>
          )}
        </div>
      </div>
      {props.error && <p className="error small">{props.error}</p>}
      {rows.length === 0 && <p className="muted small">This style has no rules yet. Add some with “Edit rules”.</p>}

      <ul className="rule-list">
        {rows.map((row, i) => (
          <li key={i} className={`rule-row ${row.status}`}>
            <div className="rule-line">
              <span className="rule-status" aria-label={row.status}>{STATUS_LABEL[row.status]}</span>
              <span className="rule-text">{row.rule}</span>
              <span className={`badge by-${row.checkedBy}`}>{row.checkedBy === "app" ? "counted" : "Claude"}</span>
            </div>
            {row.note && <div className="rule-note">{row.note}</div>}
            {row.violations.length > 0 && (
              <ul className="violations">
                {row.violations.map(({ violation: v, range }) => (
                  <li
                    key={v.id}
                    data-violation={v.id}
                    className={`violation ${props.activeViolation === v.id ? "active" : ""}`}
                    onClick={() => props.onSelect(v.id)}
                  >
                    <div className="diff">
                      <del>{v.quote}</del>
                      {v.suggestion ? <ins>{v.suggestion}</ins> : <em className="muted"> (delete)</em>}
                    </div>
                    <div className="violation-why">{v.explanation}</div>
                    {!range && <div className="muted small">Couldn't find this exact text in the draft; fix it by hand.</div>}
                    <div className="violation-actions">
                      {range && (
                        <button onClick={(e) => { e.stopPropagation(); props.onApply(v.id); }}>
                          {v.suggestion ? "Apply fix" : "Delete text"}
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); props.onDismiss(v.id); }}>Dismiss</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
