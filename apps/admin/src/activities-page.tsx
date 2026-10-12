import { Shell } from "@collective/ui";
import { useEffect, useState } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface Board {
  result?: string;
  predictions?: Array<{ id: string; title: string; mode: string; status: string; resolutionRule: string }>;
  contests?: Array<{ id: string; title: string; mode: string; status: string; tiePolicy: string }>;
  giveaways?: Array<{ id: string; title: string; status: string; snapshotLocked: boolean }>;
  draws?: Array<{ id: string; sequence: number; status: string; fulfilment: string; detail: string; delivery: string }>;
  stock?: Array<{ id: string; name: string; kind: string; onHand: number; shopStatus: string }>;
}

export function ActivitiesPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [board, setBoard] = useState<Board>({});
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [predictionId, setPredictionId] = useState("");
  const [contestId, setContestId] = useState("");
  const [giveawayId, setGiveawayId] = useState("");
  const [stockId, setStockId] = useState("");

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
          <p>Predictions, contests, and giveaways require an admin session. Missing credentials do not lock a pool, draw a winner, or deliver a prize.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  const csrf = auth.csrfToken;
  return (
    <Shell title="Activities">
      <section className="panel">
        <p>{notice}</p>
        <p>Stakes stay in escrow until resolution. A missing shop integration does not invent a prize key.</p>
        <ul>
          {(board.predictions ?? []).map((row) => <li key={row.id}>{row.title} {row.mode} {row.status} {row.resolutionRule}</li>)}
        </ul>
        <ul>
          {(board.contests ?? []).map((row) => <li key={row.id}>{row.title} {row.mode} {row.status} {row.tiePolicy}</li>)}
        </ul>
        <ul>
          {(board.giveaways ?? []).map((row) => <li key={row.id}>{row.title} {row.status} snapshot {row.snapshotLocked ? "locked" : "open"}</li>)}
        </ul>
        <ul>
          {(board.draws ?? []).map((row) => <li key={row.id}>Draw {row.sequence} {row.status} {row.fulfilment} {row.delivery}</li>)}
        </ul>
        <ul>
          {(board.stock ?? []).map((row) => <li key={row.id}>{row.name} {row.kind} on hand {row.onHand} {row.shopStatus}</li>)}
        </ul>
        <label htmlFor="activity-title">Title<input id="activity-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <button type="button" onClick={() => void stock()}>Stock an item</button>
        <button type="button" onClick={() => void prediction()}>Open a staked prediction</button>
        <button type="button" onClick={() => void contest()}>Open a contest</button>
        <button type="button" onClick={() => void giveaway()}>Open a giveaway</button>
        <label htmlFor="prediction-id">Prediction<input id="prediction-id" value={predictionId} onChange={(event) => setPredictionId(event.target.value)} /></label>
        <button type="button" onClick={() => void resolve()}>Resolve</button>
        <button type="button" onClick={() => void cancelPredictionRecord()}>Cancel prediction</button>
        <label htmlFor="contest-id">Contest<input id="contest-id" value={contestId} onChange={(event) => setContestId(event.target.value)} /></label>
        <button type="button" onClick={() => void publish()}>Publish rules</button>
        <button type="button" onClick={() => void closeContestRecord()}>Close contest</button>
        <label htmlFor="giveaway-id">Giveaway<input id="giveaway-id" value={giveawayId} onChange={(event) => setGiveawayId(event.target.value)} /></label>
        <button type="button" onClick={() => void closeGiveawayRecord()}>Lock snapshot</button>
        <button type="button" onClick={() => void draw()}>Draw</button>
        <label htmlFor="stock-id">Stock<input id="stock-id" value={stockId} onChange={(event) => setStockId(event.target.value)} /></label>
        <button type="button" onClick={() => void reload()}>Refresh</button>
      </section>
    </Shell>
  );

  async function post(path: string, payload: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(payload),
    });
    return await response.json() as Record<string, unknown>;
  }

  async function reload(token = csrf) {
    const response = await fetch("/api/activities", { headers: token ? { "x-csrf-token": token } : {} });
    if (response.ok) {
      setBoard(await response.json() as Board);
    }
  }

  async function stock() {
    const body = await post("/api/activities/stock", { name: title || "Ribbon", kind: "item", onHand: 1 });
    setNotice(typeof body["result"] === "string" ? `Stock ${body["result"]}.` : "The stock was not saved.");
    const row = body["stock"];
    if (row && typeof row === "object" && "id" in row && typeof row.id === "string") setStockId(row.id);
    await reload();
  }

  async function prediction() {
    const body = await post("/api/activities/prediction", { title: title || "Prediction", mode: "staked" });
    setNotice(typeof body["result"] === "string" ? `Prediction ${body["result"]}.` : "The prediction was not opened.");
    const row = body["prediction"];
    if (row && typeof row === "object" && "id" in row && typeof row.id === "string") setPredictionId(row.id);
    await reload();
  }

  async function contest() {
    const body = await post("/api/activities/contest", { title: title || "Contest", mode: "vote", stockId, prizeQuantity: stockId ? 1 : 0 });
    setNotice(typeof body["result"] === "string" ? `Contest ${body["result"]}.` : "The contest was not opened.");
    const row = body["contest"];
    if (row && typeof row === "object" && "id" in row && typeof row.id === "string") setContestId(row.id);
    await reload();
  }

  async function giveaway() {
    const body = await post("/api/activities/giveaway", { title: title || "Giveaway", stockId, maxBonus: 1 });
    setNotice(typeof body["result"] === "string" ? `Giveaway ${body["result"]}.` : "The giveaway was not opened.");
    const row = body["giveaway"];
    if (row && typeof row === "object" && "id" in row && typeof row.id === "string") setGiveawayId(row.id);
    await reload();
  }

  async function resolve() {
    const body = await post("/api/activities/prediction/resolve", { predictionId, outcomeId: "tie", evidence: "Staff evidence" });
    setNotice(typeof body["result"] === "string" ? `Resolve ${body["result"]}.` : "The prediction was not resolved.");
    await reload();
  }

  async function cancelPredictionRecord() {
    const body = await post("/api/activities/prediction/cancel", { predictionId });
    setNotice(typeof body["result"] === "string" ? `Cancel ${body["result"]}.` : "The prediction was not cancelled.");
    await reload();
  }

  async function publish() {
    const body = await post("/api/activities/contest/publish", { contestId });
    setNotice(typeof body["result"] === "string" ? `Publish ${body["result"]}.` : "The rules were not published.");
    await reload();
  }

  async function closeContestRecord() {
    const body = await post("/api/activities/contest/close", { contestId });
    setNotice(typeof body["result"] === "string" ? `Contest ${body["result"]}.` : "The contest was not closed.");
    await reload();
  }

  async function closeGiveawayRecord() {
    const body = await post("/api/activities/giveaway/close", { giveawayId });
    setNotice(typeof body["result"] === "string" ? `Snapshot ${body["result"]}.` : "The snapshot was not locked.");
    await reload();
  }

  async function draw() {
    const body = await post("/api/activities/giveaway/draw", { giveawayId });
    setNotice(typeof body["result"] === "string" ? `Draw ${body["result"]}.` : "The draw was not recorded.");
    await reload();
  }
}
