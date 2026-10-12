import { Shell } from "@collective/ui";
import { useEffect, useState } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

interface Objective {
  id: string;
  title: string;
  kind: string;
  band: string;
  version: number;
  rewardMarks: number;
  availability: string;
  answerSet: boolean;
}

interface Assignment {
  id: string;
  title: string;
  progress: number;
  target: number;
  rewardMarks: number;
  payoutMarks: number;
  payoutStatus: string;
  disclosure: string;
}

interface Submission {
  id: string;
  userId: string;
  body: string;
  status: string;
}

interface Board {
  result?: string;
  objectives?: Objective[];
  assignments?: Assignment[];
  submissions?: Submission[];
  settings?: { timezone: string; completionChannelId: string; dailyCap: number; weeklyCap: number; monthlyCap: number };
}

export function ContractsPage() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [board, setBoard] = useState<Board>({});
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("riddle");
  const [answer, setAnswer] = useState("");
  const [reward, setReward] = useState("20");
  const [objectiveId, setObjectiveId] = useState("");
  const [submissionId, setSubmissionId] = useState("");
  const [channelId, setChannelId] = useState("");

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
          <p>Contracts require an admin session. Missing credentials do not assign a daily board, reroll a contract, or pay a reward.</p>
          <p><a href="/">Return to the dashboard</a></p>
        </section>
      </Shell>
    );
  }

  const csrf = auth.csrfToken;
  return (
    <Shell title="Contracts">
      <section className="panel">
        <p>{notice}</p>
        <p>Daily assignments are personal. Weekly and monthly boards are shared. Turning off completion pings does not stop the reward. Caps are {board.settings?.dailyCap ?? 80} daily, {board.settings?.weeklyCap ?? 250} weekly, and {board.settings?.monthlyCap ?? 500} monthly.</p>
        <ul>
          {(board.objectives ?? []).map((row) => <li key={row.id}>{row.title} {row.kind} {row.band} v{row.version} {row.rewardMarks} Marks {row.availability}{row.answerSet ? " answer set" : ""}</li>)}
        </ul>
        <ul>
          {(board.assignments ?? []).map((row) => <li key={row.id}>{row.title} {row.progress}/{row.target} {row.payoutStatus} {row.payoutMarks}/{row.rewardMarks}. {row.disclosure}</li>)}
        </ul>
        <ul>
          {(board.submissions ?? []).map((row) => <li key={row.id}>{row.userId} {row.status} {row.body}</li>)}
        </ul>
        <label htmlFor="contract-title">Title<input id="contract-title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label htmlFor="contract-kind">Kind<input id="contract-kind" value={kind} onChange={(event) => setKind(event.target.value)} /></label>
        <label htmlFor="contract-answer">Answer<input id="contract-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
        <label htmlFor="contract-reward">Reward<input id="contract-reward" value={reward} onChange={(event) => setReward(event.target.value)} /></label>
        <button type="button" onClick={() => void createObjective()}>Save objective</button>
        <label htmlFor="objective-id">Objective<input id="objective-id" value={objectiveId} onChange={(event) => setObjectiveId(event.target.value)} /></label>
        <button type="button" onClick={() => void assign()}>Assign</button>
        <label htmlFor="submission-id">Submission<input id="submission-id" value={submissionId} onChange={(event) => setSubmissionId(event.target.value)} /></label>
        <button type="button" onClick={() => void approve()}>Approve</button>
        <label htmlFor="completion-channel">Completion channel<input id="completion-channel" value={channelId} onChange={(event) => setChannelId(event.target.value)} /></label>
        <button type="button" onClick={() => void saveChannel()}>Save completion channel</button>
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
    const response = await fetch("/api/contracts", { headers: token ? { "x-csrf-token": token } : {} });
    if (response.ok) {
      setBoard(await response.json() as Board);
    }
  }

  async function createObjective() {
    const body = await post("/api/contracts/objective", { title: title || "Staff riddle", prompt: title || "Staff riddle", kind, answer, rewardMarks: Number(reward) || 0, target: 1 });
    setNotice(typeof body["result"] === "string" ? `Objective ${body["result"]}.` : "The objective was not saved.");
    if (typeof body["objectiveId"] === "string") setObjectiveId(body["objectiveId"]);
    await reload();
  }

  async function assign() {
    const body = await post("/api/contracts/assign", { definitionId: objectiveId, board: "daily" });
    setNotice(typeof body["result"] === "string" ? `Assign ${body["result"]}.` : "The objective was not assigned.");
    await reload();
  }

  async function approve() {
    const body = await post("/api/contracts/approve", { submissionId });
    setNotice(typeof body["result"] === "string" ? `Approve ${body["result"]}.` : "The submission was not approved.");
    await reload();
  }

  async function saveChannel() {
    const body = await post("/api/contracts/settings", { completionChannelId: channelId });
    setNotice(typeof body["result"] === "string" ? `Settings ${body["result"]}.` : "The channel was not saved.");
    await reload();
  }
}
