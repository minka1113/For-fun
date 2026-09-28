import { Component, type ReactNode } from "react";

const STORAGE_KEY = "source-lens:v1";

/** Downloads the browser's saved workspace so nothing is lost while fixing a problem. */
export function downloadBackup(): void {
  const raw = localStorage.getItem(STORAGE_KEY) ?? "{}";
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `source-lens-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Shows what went wrong instead of a blank page when the app crashes while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>The app hit an error and couldn't display the page. Your saved work is still stored in this browser.</p>
        <pre>{`${error.name}: ${error.message}\n\n${(error.stack ?? "").split("\n").slice(0, 8).join("\n")}`}</pre>
        <p className="muted small">If you ask for help, copy the text in the box above.</p>
        <div className="home-actions">
          <button className="primary" onClick={() => location.reload()}>Reload</button>
          <button onClick={downloadBackup}>Download a backup of my data</button>
          <button
            className="danger"
            onClick={() => {
              if (!confirm("Clear this browser's saved projects and start fresh? A backup file downloads first.")) return;
              downloadBackup();
              localStorage.removeItem(STORAGE_KEY);
              location.reload();
            }}
          >
            Reset saved data
          </button>
        </div>
      </div>
    );
  }
}
