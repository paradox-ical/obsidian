import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface ModuleRow {
  moduleKey: string;
  maintenance: boolean;
  available: boolean;
  protected: boolean;
}

interface VersionRow {
  id: string;
  version: number;
  state: string;
  active: boolean;
}

interface JobRow {
  id: string;
  jobType: string;
  lastError: string | null;
  attempts: number;
}

interface OperationsView {
  modules?: ModuleRow[];
  versions?: VersionRow[];
  activeVersion?: number | null;
  jobs?: JobRow[];
  health?: {
    deadJobs?: number;
    discordDeliveryFailures?: number;
    negativeWallets?: number;
    duplicateRewards?: number;
    stalledMatches?: number;
    overdueRooms?: number;
    backing?: string;
    ticketRetentionDays?: number;
    warningRetentionDays?: number;
    alerts?: string[];
  };
  simulations?: { economy?: { routineMarks?: number }; blackjack?: { worstPlayerLossMarks?: number }; grants?: string };
}

export function OperationsPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<OperationsView>({});
  const [notice, setNotice] = useState("");
  const [moduleKey, setModuleKey] = useState("economy");
  const [maintenance, setMaintenance] = useState(true);
  const [reason, setReason] = useState("");
  const [documentText, setDocumentText] = useState("{\n  \"label\": \"Hall\"\n}");
  const [draftId, setDraftId] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [confirmRollback, setConfirmRollback] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((status) => {
        setAuth(status);
        if (status.authenticated) {
          void reload();
        }
      })
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);

  if (!auth?.authenticated || !auth.csrfToken) {
    return (
      <Shell title="Admin access is closed">
        <section className="panel">
          <p>Operations requires an admin session. Members and other staff keep using the Discord commands their capabilities allow.</p>
          <p>A draft configuration is not the active configuration. Rollback copies an older version into a new row and leaves the history in place.</p>
          <p>Economy and combat simulations do not grant Marks, Ingots, or items. Verification and moderation stay available during maintenance.</p>
          <p>Dead jobs, Discord delivery failures, backing, wallet discrepancies, overdue rooms, and duplicate rewards are shown here. Health responses do not include secrets.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  async function reload() {
    const response = await fetch("/api/operations");
    setView(await response.json() as OperationsView);
  }

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify(body),
    });
    return response.json() as Promise<Record<string, unknown>>;
  }

  async function saveMaintenance(event: FormEvent) {
    event.preventDefault();
    const body = await post("/api/operations/maintenance", { moduleKey, maintenance, reason });
    setNotice(body["result"] === "saved" ? "Maintenance was saved." : body["result"] === "protected" ? "Verification and moderation stay available." : "Maintenance was not saved.");
    await reload();
  }

  async function validateDocument(event: FormEvent) {
    event.preventDefault();
    const document = parseDocument();
    if (!document) {
      return;
    }
    const body = await post("/api/operations/preview", { document });
    setNotice(body["ok"] === true ? "The preview was not saved." : `The document was rejected. ${Array.isArray(body["errors"]) ? body["errors"].join(" ") : ""}`);
  }

  async function saveDraft() {
    const document = parseDocument();
    if (!document) {
      return;
    }
    const body = await post("/api/operations/draft", { document, reason });
    if (typeof body["draftId"] === "string") {
      setDraftId(body["draftId"]);
    }
    setNotice(body["result"] === "draft" ? "The draft was saved and is not active." : "The draft was not saved.");
    await reload();
  }

  async function publishDraft(event: FormEvent) {
    event.preventDefault();
    const body = await post("/api/operations/publish", { draftId, reason });
    setNotice(body["result"] === "published" ? "The draft was published." : "The draft was not published.");
    await reload();
  }

  async function rollback(event: FormEvent) {
    event.preventDefault();
    const body = await post("/api/operations/rollback", { version: Number(rollbackVersion), reason, confirm: confirmRollback });
    setNotice(body["result"] === "published" ? "The selected version was copied and published." : body["result"] === "draft" ? "A rollback draft was saved and is not active." : "The rollback was not saved.");
    await reload();
  }

  async function exportConfig() {
    const response = await fetch("/api/operations/export");
    const body = await response.json() as unknown;
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "collective-config.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice("The export omits secrets.");
  }

  async function simulate() {
    const response = await fetch("/api/operations/simulate");
    const body = await response.json() as OperationsView["simulations"] & { grants?: string };
    setView((current) => ({ ...current, simulations: body }));
    setNotice(body.grants === "none" ? "The simulation did not grant anything." : "The simulation did not run.");
  }

  async function recordAlert(event: FormEvent) {
    event.preventDefault();
    const body = await post("/api/operations/alert", { reason });
    setNotice(body["result"] === "recorded" ? "The alert was recorded. It was not posted to Discord." : body["result"] === "clear" ? "There is no invariant alert to record." : "The alert was not recorded.");
    await reload();
  }

  function parseDocument(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(documentText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setNotice("Configuration must be an object.");
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setNotice("Configuration must be JSON.");
      return null;
    }
  }

  return (
    <Shell title="Operations">
      <section className="panel">
        <h2>Health</h2>
        <dl className="facts">
          <div><dt>Dead jobs</dt><dd>{view.health?.deadJobs ?? 0}</dd></div>
          <div><dt>Discord delivery failures</dt><dd>{view.health?.discordDeliveryFailures ?? 0}</dd></div>
          <div><dt>Negative wallets</dt><dd>{view.health?.negativeWallets ?? 0}</dd></div>
          <div><dt>Duplicate rewards</dt><dd>{view.health?.duplicateRewards ?? 0}</dd></div>
          <div><dt>Stalled matches</dt><dd>{view.health?.stalledMatches ?? 0}</dd></div>
          <div><dt>Overdue rooms</dt><dd>{view.health?.overdueRooms ?? 0}</dd></div>
          <div><dt>Backing</dt><dd>{view.health?.backing ?? "not_opened"}</dd></div>
          <div><dt>Active configuration</dt><dd>{view.activeVersion ?? "none"}</dd></div>
        </dl>
        <p>Ticket text is kept for {view.health?.ticketRetentionDays ?? 14} days. Warning text is kept for {view.health?.warningRetentionDays ?? 14} days.</p>
        {view.jobs && view.jobs.length > 0 ? (
          <ul>
            {view.jobs.map((job) => <li key={job.id}>{job.jobType}: {job.lastError ?? "no error"}</li>)}
          </ul>
        ) : <p>No dead jobs are waiting.</p>}
        <form onSubmit={recordAlert}>
          <label htmlFor="alert-reason">Alert reason</label>
          <input id="alert-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit">Record the invariant alert</button>
        </form>
      </section>
      <section className="panel">
        <h2>Maintenance</h2>
        <form onSubmit={saveMaintenance}>
          <label htmlFor="module-key">Module</label>
          <select id="module-key" value={moduleKey} onChange={(event) => setModuleKey(event.target.value)}>
            {(view.modules ?? []).map((module) => (
              <option key={module.moduleKey} value={module.moduleKey}>{module.moduleKey}{module.available ? "" : " (paused)"}</option>
            ))}
          </select>
          <label htmlFor="maintenance-reason">Reason</label>
          <input id="maintenance-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <label htmlFor="maintenance-on"><input id="maintenance-on" type="checkbox" checked={maintenance} onChange={(event) => setMaintenance(event.target.checked)} /> Pause this module</label>
          <button type="submit">Save maintenance</button>
        </form>
      </section>
      <section className="panel">
        <h2>Configuration</h2>
        <p>Draft rows stay inactive until they are published. The export is the newest published document with secret fields removed.</p>
        <ul>
          {(view.versions ?? []).map((version) => (
            <li key={version.id}>Version {version.version} is {version.state}{version.active ? " and active" : ""}.</li>
          ))}
        </ul>
        <form onSubmit={validateDocument}>
          <label htmlFor="config-reason">Reason</label>
          <input id="config-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <label htmlFor="config-document">Configuration JSON</label>
          <textarea id="config-document" value={documentText} onChange={(event) => setDocumentText(event.target.value)} />
          <div className="editor-actions">
            <button type="submit">Validate</button>
            <button type="button" onClick={saveDraft}>Save draft</button>
            <button type="button" onClick={exportConfig}>Export active configuration</button>
          </div>
        </form>
        <form onSubmit={publishDraft}>
          <label htmlFor="draft-id">Draft id</label>
          <input id="draft-id" value={draftId} onChange={(event) => setDraftId(event.target.value)} />
          <button type="submit">Publish draft</button>
        </form>
        <form onSubmit={rollback}>
          <label htmlFor="rollback-version">Version to copy</label>
          <input id="rollback-version" inputMode="numeric" value={rollbackVersion} onChange={(event) => setRollbackVersion(event.target.value)} />
          <label htmlFor="rollback-confirm"><input id="rollback-confirm" type="checkbox" checked={confirmRollback} onChange={(event) => setConfirmRollback(event.target.checked)} /> Publish the copied version</label>
          <button type="submit">Roll back</button>
        </form>
      </section>
      <section className="panel">
        <h2>Simulation</h2>
        <p>The routine month is {view.simulations?.economy?.routineMarks ?? "not loaded"} Marks. Blackjack's worst loss at the default maximum is {view.simulations?.blackjack?.worstPlayerLossMarks ?? "not loaded"} Marks. Nothing is granted.</p>
        <button type="button" onClick={() => void simulate()}>Run simulations</button>
        {notice ? <p role="status">{notice}</p> : null}
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}
