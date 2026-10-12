import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  summary: string;
  classSlug: string;
  level: number;
  version: number;
  affixMax: number;
  affixRules: Array<{ slug: string; stat: string; min: number; max: number }>;
}

interface StaffView {
  rules?: string[];
  templates?: TemplateRow[];
  opponents?: Array<{ id: string; name: string; health: number; version: number }>;
  ranked?: { statBudget: number; gearBudget: number; abilityLevel: number; pairLimit: number; graceMinutes: number; rewardMarks: number };
  reviews?: number;
  workshop?: {
    rules?: string;
    caps?: { upgradeCap: number; listingLimit: number; listingHours: number; listingFeeMarks: number; rerollBaseMarks: number };
    recipes?: Array<{ slug: string; name: string; inputAmount: number; inputSlug: string; outputSlug: string }>;
  };
  result?: string;
}

export function CombatPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [view, setView] = useState<StaffView>({});
  const [notice, setNotice] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [summary, setSummary] = useState("");
  const [level, setLevel] = useState("1");
  const [opponentId, setOpponentId] = useState("");
  const [health, setHealth] = useState("16");

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
          <p>Combat requires an admin session. Missing credentials do not join a queue, accept a challenge, or settle a wager.</p>
          <p>Ranked play uses one stat budget and a published gear limit. A repeated pair becomes casual before it can be accepted. A draw refunds both stakes.</p>
          <p>Missing credentials do not offer a trade, list gear, upgrade an item, salvage it, craft a recipe, or reroll an affix. An edit clears both trade confirmations. Salvage waits for a separate destruction confirmation.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  const selected = view.templates?.find((item) => item.id === templateId) ?? view.templates?.[0];

  async function reload() {
    const response = await fetch("/api/combat");
    const body = await response.json() as StaffView;
    setView(body);
    const first = body.templates?.[0];
    if (first) {
      setTemplateId(first.id);
      setSummary(first.summary);
      setLevel(String(first.level));
    }
    const opponent = body.opponents?.[0];
    if (opponent) {
      setOpponentId(opponent.id);
      setHealth(String(opponent.health));
    }
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    const response = await fetch("/api/combat/template", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ templateId: selected.id, summary, level: Number(level), classSlug: selected.classSlug, affixMax: selected.affixMax }),
    });
    const body = await response.json() as { result?: string; version?: number };
    setNotice(body.result === "saved" ? `Template version ${body.version ?? ""}. Existing rolls stay on their instances.` : "The template was not saved.");
    await reload();
  }

  async function saveOpponent(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/combat/opponent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ opponentId, health: Number(health) }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result === "saved" ? "Test opponent saved. An open battle keeps the health it started with." : "The opponent was not saved.");
    await reload();
  }

  return (
    <Shell title="Combat">
      <section className="panel">
        <h2>Rules</h2>
        <ul>{view.rules?.map((rule) => <li key={rule}>{rule}</li>)}</ul>
        <p>Ranked budget {view.ranked?.statBudget ?? 0} stat points, gear power {view.ranked?.gearBudget ?? 0}, abilities through level {view.ranked?.abilityLevel ?? 0}. The first {view.ranked?.pairLimit ?? 0} matches against one opponent each day stay ranked. Disconnect grace is {view.ranked?.graceMinutes ?? 0} minutes. Open reviews: {view.reviews ?? 0}.</p>
        <p>{view.workshop?.rules}</p>
        <p>Upgrade cap {view.workshop?.caps?.upgradeCap ?? 0}. Listings {view.workshop?.caps?.listingLimit ?? 0} for {view.workshop?.caps?.listingHours ?? 0} hours. Listing fee {view.workshop?.caps?.listingFeeMarks ?? 0}. Reroll base {view.workshop?.caps?.rerollBaseMarks ?? 0} Marks.</p>
        <ul>{view.workshop?.recipes?.map((recipe) => <li key={recipe.slug}>{recipe.name}: {recipe.inputAmount} {recipe.inputSlug} crafts {recipe.outputSlug}.</li>)}</ul>
        {notice ? <p>{notice}</p> : null}
      </section>
      <form className="panel" onSubmit={(event) => void saveTemplate(event)}>
        <h2>Gear template</h2>
        <label>Template
          <select value={selected?.id ?? ""} onChange={(event) => {
            const next = view.templates?.find((item) => item.id === event.target.value);
            setTemplateId(event.target.value);
            setSummary(next?.summary ?? "");
            setLevel(String(next?.level ?? 1));
          }}>
            {view.templates?.map((item) => <option key={item.id} value={item.id}>{item.name} v{item.version}</option>)}
          </select>
        </label>
        <label>Summary <textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>Level <input value={level} onChange={(event) => setLevel(event.target.value)} /></label>
        <button type="submit">Save template</button>
        <ul>{selected?.affixRules.map((rule) => <li key={rule.slug}>{rule.slug} {rule.stat} {rule.min} to {rule.max}</li>)}</ul>
      </form>
      <form className="panel" onSubmit={(event) => void saveOpponent(event)}>
        <h2>Test opponent</h2>
        <label>Health <input value={health} onChange={(event) => setHealth(event.target.value)} /></label>
        <button type="submit">Save opponent</button>
      </form>
    </Shell>
  );
}
