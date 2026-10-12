import { Shell } from "@collective/ui";
import { useEffect, useState } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface OccurrenceRow {
  id: string;
  name: string;
  startsAt: string;
  status: string;
  syncStatus: string;
  syncReason: string;
  discordEventId: string | null;
  detached: boolean;
}

interface SyncRow {
  id: string;
  action: string;
  status: string;
  reason: string;
}

interface Board {
  result?: string;
  occurrences?: OccurrenceRow[];
  syncs?: SyncRow[];
  crews?: Array<{ id: string; name: string; status: string; leaderUserId: string }>;
  sessions?: Array<{ id: string; name: string; status: string; joinMode: string; rpgStatus: string; roomId: string | null }>;
}

export function GatheringsPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [board, setBoard] = useState<Board>({});
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [when, setWhen] = useState("");
  const [occurrenceId, setOccurrenceId] = useState("");
  const [scope, setScope] = useState("occurrence");
  const [hostUserId, setHostUserId] = useState("");
  const [crewName, setCrewName] = useState("");
  const [crewId, setCrewId] = useState("");
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then(async (response) => setAuth((await response.json()) as AuthStatus))
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);

  async function reload() {
    const response = await fetch("/api/gatherings");
    setBoard((await response.json()) as Board);
  }

  useEffect(() => {
    if (!auth?.authenticated) return;
    const controller = new AbortController();
    fetch("/api/gatherings", { signal: controller.signal })
      .then(async (response) => setBoard((await response.json()) as Board))
      .catch(() => setBoard({}));
    return () => controller.abort();
  }, [auth]);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  if (!auth?.authenticated) {
    return (
      <Shell title="Admin access is closed">
        <section className="panel">
          <p>Official events, crews, and LFG require an admin session. Missing credentials do not schedule an event or sync one to Discord.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell title="Events and crews">
      <section className="panel editor-grid">
        <p>Each occurrence keeps its own id. Editing one occurrence does not change the series. Discord scheduled-event sync stays setup-required until a bot token exists, and a failure stays visible. Crew RPG missions are not built.</p>
        {notice ? <p role="status">{notice}</p> : null}
        <h2>Schedule</h2>
        <ul>
          {(board.occurrences ?? []).map((row) => (
            <li key={row.id}>{row.startsAt} {row.name} {row.status} {row.detached ? "detached" : "series"} sync {row.syncStatus}{row.syncReason ? `: ${row.syncReason}` : ""}</li>
          ))}
        </ul>
        <h2>Sync record</h2>
        <ul>
          {(board.syncs ?? []).map((row) => <li key={row.id}>{row.action} {row.status}: {row.reason}</li>)}
        </ul>
        <label htmlFor="event-name">Event name<input id="event-name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label htmlFor="event-cadence">Cadence
          <select id="event-cadence" value={cadence} onChange={(event) => setCadence(event.target.value)}>
            <option value="once">One-off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label htmlFor="event-when">One-off time<input id="event-when" value={when} onChange={(event) => setWhen(event.target.value)} /></label>
        <button type="button" onClick={() => void schedule()}>Schedule event</button>
        <label htmlFor="occurrence">Occurrence<input id="occurrence" value={occurrenceId} onChange={(event) => setOccurrenceId(event.target.value)} /></label>
        <label htmlFor="scope">Edit scope
          <select id="scope" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="occurrence">This occurrence</option>
            <option value="series">The series</option>
          </select>
        </label>
        <button type="button" onClick={() => void edit()}>Save edit</button>
        <button type="button" onClick={() => void cancel()}>Cancel</button>
        <label htmlFor="host">New host<input id="host" value={hostUserId} onChange={(event) => setHostUserId(event.target.value)} /></label>
        <button type="button" onClick={() => void transfer()}>Transfer host</button>
        <h2>Crews and LFG</h2>
        <ul>
          {(board.crews ?? []).map((crew) => <li key={crew.id}>{crew.name} {crew.status} leader {crew.leaderUserId}</li>)}
        </ul>
        <ul>
          {(board.sessions ?? []).map((session) => <li key={session.id}>{session.name} {session.status} {session.joinMode} room {session.roomId ?? "none"} {session.rpgStatus}</li>)}
        </ul>
        <label htmlFor="crew-name">Crew name<input id="crew-name" value={crewName} onChange={(event) => setCrewName(event.target.value)} /></label>
        <button type="button" onClick={() => void createCrewRecord()}>Create crew</button>
        <label htmlFor="crew-id">Crew<input id="crew-id" value={crewId} onChange={(event) => setCrewId(event.target.value)} /></label>
        <button type="button" onClick={() => void createSession()}>Open session</button>
        <label htmlFor="session-id">Session<input id="session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} /></label>
        <button type="button" onClick={() => void room()}>Link temporary room</button>
        <button type="button" onClick={() => void mission()}>Request RPG mission</button>
        <button type="button" onClick={() => void reload()}>Refresh</button>
      </section>
    </Shell>
  );

  async function schedule() {
    const body = await post("/api/gatherings/event", {
      name,
      cadence,
      scheduledFor: when || null,
      timezone: "Australia/Perth",
      hour: 9,
      minute: 0,
      weekday: cadence === "weekly" ? 1 : null,
      dayOfMonth: cadence === "monthly" ? 1 : null,
      capacity: 25,
      waitlist: true,
      rewardMarks: 0,
      rewardBudget: 0,
      durationMinutes: 60,
    });
    setNotice(typeof body["result"] === "string" ? `Event ${body["result"]}.` : "The event was not scheduled.");
    const occurrence = body["occurrence"];
    if (occurrence && typeof occurrence === "object" && "id" in occurrence && typeof occurrence.id === "string") {
      setOccurrenceId(occurrence.id);
    }
    await reload();
  }

  async function edit() {
    const body = await post("/api/gatherings/event/edit", { occurrenceId, scope, name });
    setNotice(typeof body["result"] === "string" ? `Edit ${body["result"]}.` : "The edit was not saved.");
    await reload();
  }

  async function cancel() {
    const body = await post("/api/gatherings/event/cancel", { occurrenceId, scope });
    setNotice(typeof body["result"] === "string" ? `Cancel ${body["result"]}.` : "The event was not cancelled.");
    await reload();
  }

  async function transfer() {
    const body = await post("/api/gatherings/event/transfer", { occurrenceId, hostUserId });
    setNotice(typeof body["result"] === "string" ? `Host ${body["result"]}.` : "The host was not transferred.");
    await reload();
  }

  async function createCrewRecord() {
    const body = await post("/api/gatherings/crew", { name: crewName, game: "", platform: "", region: "", rewardMarks: 0 });
    setNotice(typeof body["result"] === "string" ? `Crew ${body["result"]}.` : "The crew was not created.");
    const crew = body["crew"];
    if (crew && typeof crew === "object" && "id" in crew && typeof crew.id === "string") setCrewId(crew.id);
    await reload();
  }

  async function createSession() {
    const body = await post("/api/gatherings/session", { crewId, name: crewName || "Session", game: "", platform: "", region: "", size: 4, joinMode: "open" });
    setNotice(typeof body["result"] === "string" ? `Session ${body["result"]}.` : "The session was not opened.");
    const session = body["session"];
    if (session && typeof session === "object" && "id" in session && typeof session.id === "string") setSessionId(session.id);
    await reload();
  }

  async function room() {
    const body = await post("/api/gatherings/session/room", { sessionId });
    setNotice(typeof body["result"] === "string" ? `Room ${body["result"]}.` : "The room was not linked.");
    await reload();
  }

  async function mission() {
    const body = await post("/api/gatherings/mission", { crewId });
    setNotice(body["result"] === "module_not_built" ? "Crew RPG missions are not built." : "The mission request did not complete.");
  }
}
