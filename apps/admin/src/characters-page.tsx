import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface Ability {
  name: string;
  kind: string;
  unlockLevel: number;
  formula: string;
}

interface ClassRow {
  id: string;
  slug: string;
  name: string;
  summary: string;
  version: number;
  base: { strength: number; agility: number; endurance: number; focus: number };
  abilities: Ability[];
}

interface StaffView {
  curve?: { version: number; xpFactor: number; sessionXp: number; sessionsPerWeek: number };
  classes?: ClassRow[];
  simulation?: { level: number; weeks: number; sessions: number; requiredXp: number; assumptions: string[] };
  fees?: { respecMarks: number; classChangeMarks: number };
  result?: string;
}

export function CharactersPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [classId, setClassId] = useState("");
  const [summary, setSummary] = useState("");
  const [xpFactor, setXpFactor] = useState("100");
  const [sessionXp, setSessionXp] = useState("1200");
  const [sessionsPerWeek, setSessionsPerWeek] = useState("4");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then((status) => {
        setAuth(status);
        if (status.authenticated) {
          void reload(status.csrfToken);
        }
      })
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);

  if (!auth?.authenticated || !auth.csrfToken) {
    return (
      <Shell title="Admin access is closed">
        <section className="panel">
          <p>Characters require an admin session. Missing credentials do not choose a class, respec, or spend Marks.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  const selected = view.classes?.find((item) => item.id === classId) ?? view.classes?.[0];

  async function reload(csrfToken?: string) {
    const response = await fetch("/api/characters", { headers: csrfToken ? { "x-csrf-token": csrfToken } : {} });
    const body = await response.json() as StaffView;
    setView(body);
    const first = body.classes?.[0];
    if (first) {
      setClassId(first.id);
      setSummary(first.summary);
    }
    if (body.curve) {
      setXpFactor(String(body.curve.xpFactor));
      setSessionXp(String(body.curve.sessionXp));
      setSessionsPerWeek(String(body.curve.sessionsPerWeek));
    }
  }

  async function saveCurve(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/characters/curve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ xpFactor: Number(xpFactor), sessionXp: Number(sessionXp), sessionsPerWeek: Number(sessionsPerWeek) }),
    });
    const body = await response.json() as StaffView;
    setNotice(body.result === "saved" ? "Curve saved. Existing characters keep their level and points." : "The curve was not saved.");
    await reload(auth?.csrfToken);
  }

  async function saveClass(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const response = await fetch("/api/characters/class", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ classId: selected.id, summary, baseStrength: selected.base.strength, baseAgility: selected.base.agility, baseEndurance: selected.base.endurance, baseFocus: selected.base.focus }),
    });
    const body = await response.json() as { result?: string; version?: number };
    setNotice(body.result === "saved" ? `Class version ${body.version ?? ""}. Existing characters keep their level and points.` : "The class was not saved.");
    await reload(auth?.csrfToken);
  }

  return (
    <Shell title="Characters">
      <section className="panel">
        <p>Respec costs {view.fees?.respecMarks ?? 5000} Marks. A class change costs {view.fees?.classChangeMarks ?? 15000} Marks and includes the respec. Chat does not grant these points.</p>
        {view.simulation ? <p>Regular play reaches level {view.simulation.level} in {view.simulation.weeks} weeks across {view.simulation.sessions} sessions. Reaching level 50 costs {view.simulation.requiredXp} XP.</p> : null}
        <ul>{view.simulation?.assumptions.map((line) => <li key={line}>{line}</li>)}</ul>
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveCurve(event)}>
        <h2>Progression curve</h2>
        <label>XP factor <input value={xpFactor} onChange={(event) => setXpFactor(event.target.value)} /></label>
        <label>Session XP <input value={sessionXp} onChange={(event) => setSessionXp(event.target.value)} /></label>
        <label>Sessions each week <input value={sessionsPerWeek} onChange={(event) => setSessionsPerWeek(event.target.value)} /></label>
        <button type="submit">Save curve</button>
      </form>
      <form className="panel" onSubmit={(event) => void saveClass(event)}>
        <h2>Class text</h2>
        <label>Class
          <select value={selected?.id ?? ""} onChange={(event) => {
            const next = view.classes?.find((item) => item.id === event.target.value);
            setClassId(event.target.value);
            setSummary(next?.summary ?? "");
          }}>
            {view.classes?.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.version}</option>)}
          </select>
        </label>
        <label>Summary <textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <button type="submit">Save class</button>
        <ul>
          {selected?.abilities.map((ability) => <li key={ability.name}>{ability.name}, {ability.kind}, level {ability.unlockLevel}. {ability.formula}</li>)}
        </ul>
      </form>
    </Shell>
  );
}
