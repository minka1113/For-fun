import type { RuleSet } from "../../shared/types";
import type { RuleRow } from "../lib/style";

interface Props {
  rows: RuleRow[];
  ruleSets: RuleSet[];
  /** The set this draft is checked against. */
  ruleSetId: string;
  /** True when the draft's own set was deleted and it fell back to the project default. */
  fellBack: boolean;
  onChangeRuleSet: (id: string) => void;
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
      {props.fellBack && (
        <p className="ruleset-notice">This draft's rule set was deleted, so it's using the project's default set instead.</p>
      )}
      <div className="style-head">
        <label className="toggle">
          Rules:
          <select value={props.ruleSetId} onChange={(e) => props.onChangeRuleSet(e.target.value)} aria-label="Rule set for this draft">
            {props.ruleSets.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <button className="link" onClick={props.onEditRules}>Manage rule sets</button>
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
      {rows.length === 0 && <p className="muted small">This rule set has no rules yet. Add some with “Manage rule sets”.</p>}

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
