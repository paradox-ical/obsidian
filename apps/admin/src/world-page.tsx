import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface RegionRow {
  id: string;
  name: string;
  slug: string;
  summary: string;
  level: number;
  version: number;
}

interface EnemyRow {
  id: string;
  name: string;
  ability: string;
  health: number;
  boss: boolean;
  summary: string;
  version: number;
}

interface LootRow {
  id: string;
  name: string;
  version: number;
  entries: Array<{ templateSlug: string; weight: number; source: string }>;
}

interface StaffView {
  remaining?: string[];
  regions?: RegionRow[];
  enemies?: EnemyRow[];
  loot?: LootRow[];
  counts?: { regions: number; enemies: number; bosses: number };
  missions?: Array<{ slug: string; name: string; summary: string }>;
  recovery?: { minutes: number; minimumMinutes: number; medkitMinutes: number };
}

export function WorldPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [regionId, setRegionId] = useState("");
  const [summary, setSummary] = useState("");
  const [level, setLevel] = useState("1");
  const [enemyId, setEnemyId] = useState("");
  const [health, setHealth] = useState("12");
  const [ability, setAbility] = useState("strike");
  const [weight, setWeight] = useState("1");

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
          <p>Regions require an admin session. Missing credentials do not start a mission, shorten recovery, or reserve a crew room.</p>
          <p>A defeat drops unbanked loot and starts recovery. Owned gear and the wallet stay safe.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  const selected = view.regions?.find((item) => item.id === regionId) ?? view.regions?.[0];
  const enemy = view.enemies?.find((item) => item.id === enemyId) ?? view.enemies?.[0];
  const table = view.loot?.[0];

  async function reload() {
    const response = await fetch("/api/world");
    const body = await response.json() as StaffView;
    setView(body);
    const first = body.regions?.[0];
    if (first) {
      setRegionId(first.id);
      setSummary(first.summary);
      setLevel(String(first.level));
    }
    const firstEnemy = body.enemies?.[0];
    if (firstEnemy) {
      setEnemyId(firstEnemy.id);
      setHealth(String(firstEnemy.health));
      setAbility(firstEnemy.ability);
    }
    const entry = body.loot?.[0]?.entries[0];
    if (entry) {
      setWeight(String(entry.weight));
    }
  }

  async function saveRegion(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const response = await fetch("/api/world/region", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ regionId: selected.id, summary, level: Number(level) }),
    });
    const body = await response.json() as { result?: string; version?: number };
    setNotice(body.result === "saved" ? `Region version ${body.version ?? ""}. An expedition already running keeps the level it started with.` : "The region was not saved.");
    await reload();
  }

  async function saveEnemy(event: FormEvent) {
    event.preventDefault();
    if (!enemy) {
      return;
    }
    const response = await fetch("/api/world/enemy", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ enemyId: enemy.id, health: Number(health), ability }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Enemy saved. An expedition already running keeps the enemy it started with." : "The enemy was not saved.");
    await reload();
  }

  async function saveLoot(event: FormEvent) {
    event.preventDefault();
    const entry = table?.entries[0];
    if (!table || !entry) {
      return;
    }
    const response = await fetch("/api/world/loot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ tableId: table.id, templateSlug: entry.templateSlug, weight: Number(weight) }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Loot weight saved. A running expedition keeps its preselected drop." : "The loot table was not saved.");
    await reload();
  }

  return (
    <Shell title="Regions">
      <section className="panel">
        <h2>Missions</h2>
        <ul>{view.missions?.map((mission) => <li key={mission.slug}>{mission.name}. {mission.summary}</li>)}</ul>
        <p>Recovery lasts {view.recovery?.minutes ?? 0} minutes. A recovery medkit shortens it by {view.recovery?.medkitMinutes ?? 0} minutes and cannot pass {view.recovery?.minimumMinutes ?? 0} minutes. It does not heal inside a fight.</p>
        <h2>Still not built</h2>
        <ul>{view.remaining?.map((line) => <li key={line}>{line}</li>)}</ul>
        <p>{view.counts?.regions ?? 0} regions, {view.counts?.enemies ?? 0} enemies, {view.counts?.bosses ?? 0} bosses.</p>
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveRegion(event)}>
        <h2>Region</h2>
        <label>Region
          <select value={selected?.id ?? ""} onChange={(event) => {
            const next = view.regions?.find((item) => item.id === event.target.value);
            setRegionId(event.target.value);
            setSummary(next?.summary ?? "");
            setLevel(String(next?.level ?? 1));
          }}>
            {view.regions?.map((item) => <option key={item.id} value={item.id}>{item.name} level {item.level}</option>)}
          </select>
        </label>
        <label>Summary <textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>Level <input value={level} onChange={(event) => setLevel(event.target.value)} /></label>
        <button type="submit">Save region</button>
      </form>
      <form className="panel" onSubmit={(event) => void saveEnemy(event)}>
        <h2>Enemy</h2>
        <label>Enemy
          <select value={enemy?.id ?? ""} onChange={(event) => {
            const next = view.enemies?.find((item) => item.id === event.target.value);
            setEnemyId(event.target.value);
            setHealth(String(next?.health ?? 1));
            setAbility(next?.ability ?? "strike");
          }}>
            {view.enemies?.map((item) => <option key={item.id} value={item.id}>{item.name}{item.boss ? " boss" : ""}</option>)}
          </select>
        </label>
        <p>{enemy?.summary}</p>
        <label>Health <input value={health} onChange={(event) => setHealth(event.target.value)} /></label>
        <label>Ability <input value={ability} onChange={(event) => setAbility(event.target.value)} /></label>
        <button type="submit">Save enemy</button>
      </form>
      <form className="panel" onSubmit={(event) => void saveLoot(event)}>
        <h2>Loot</h2>
        <p>{table?.name} version {table?.version}. {table?.entries[0]?.templateSlug} from {table?.entries[0]?.source}.</p>
        <label>Weight <input value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
        <button type="submit">Save loot weight</button>
      </form>
    </Shell>
  );
}
