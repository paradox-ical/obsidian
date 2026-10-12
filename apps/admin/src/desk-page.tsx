import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

interface AuthStatus {
  authenticated?: boolean;
  csrfToken?: string;
}

function useSession() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then((response) => response.json() as Promise<AuthStatus>)
      .then(setAuth)
      .catch(() => setAuth({ authenticated: false }));
    return () => controller.abort();
  }, []);
  return auth;
}

function Closed(props: { sentences: string[] }) {
  return (
    <Shell title="Admin access is closed">
      <section className="panel">
        {props.sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}
        <p>Members and other staff use Discord. A moderator capability does not open this dashboard.</p>
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}

function DocumentEditor(props: {
  title: string;
  loadPath: string;
  savePath: string;
  documentKey: string;
  sentences: string[];
  children?: (auth: AuthStatus, reload: () => Promise<void>) => ReactNode;
}) {
  const auth = useSession();
  const [view, setView] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const response = await fetch(props.loadPath);
    setView(await response.json() as Record<string, unknown>);
  }

  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    const controller = new AbortController();
    fetch(props.loadPath, { signal: controller.signal })
      .then(async (response) => setView(await response.json() as Record<string, unknown>))
      .catch(() => undefined);
    return () => controller.abort();
  }, [auth?.authenticated, props.loadPath]);

  if (!auth || !auth.authenticated || !auth.csrfToken) {
    return <Closed sentences={props.sentences} />;
  }
  const csrfToken = auth.csrfToken;

  const document = view[props.documentKey];
  const editable = document !== null && typeof document === "object" && !Array.isArray(document);

  async function submit(event: { preventDefault(): void }, preview: boolean) {
    event.preventDefault();
    if (!editable) {
      setNotice("There is no document to save.");
      return;
    }
    const response = await fetch(props.savePath, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ [props.documentKey]: document, reason, preview }),
    });
    const body = await response.json() as { persisted?: boolean; version?: number };
    setNotice(preview || body.persisted === false ? "The preview was not saved." : typeof body.version === "number" ? `Version ${body.version} was saved.` : "The document was not saved.");
    if (!preview) {
      await reload();
    }
  }

  return (
    <Shell title={props.title}>
      <section className="panel">
        <p>Stored version {typeof view["version"] === "number" ? view["version"] : 0}. A preview does not become the active document.</p>
        <pre className="preview">{JSON.stringify(document ?? view, null, 2)}</pre>
        <form onSubmit={(event) => void submit(event, false)}>
          <label htmlFor={`${props.documentKey}-reason`}>Reason</label>
          <textarea id={`${props.documentKey}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="editor-actions">
            <button type="button" onClick={(event) => void submit(event, true)}>Preview</button>
            <button type="submit">Save</button>
          </div>
        </form>
        {notice ? <p role="status">{notice}</p> : null}
        {props.children ? props.children(auth, reload) : null}
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}

export function EconomyPage() {
  return (
    <DocumentEditor
      title="Economy"
      loadPath="/api/economy/settings"
      savePath="/api/economy/settings"
      documentKey="settings"
      sentences={[
        "Economy settings require an admin session. Missing credentials do not change budgets or grant Marks.",
        "A preview shows the routine month and does not write a ledger row.",
      ]}
    />
  );
}

export function ModerationPage() {
  const auth = useSession();
  const [cases, setCases] = useState("Cases stay hidden until an admin session loads them.");
  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    void fetch("/api/moderation/cases").then(async (response) => {
      setCases(JSON.stringify(await response.json()));
    });
  }, [auth?.authenticated]);
  return (
    <DocumentEditor
      title="Moderation"
      loadPath="/api/moderation/policy"
      savePath="/api/moderation/policy"
      documentKey="policy"
      sentences={[
        "Moderation policy and cases require an admin session. Automatic ban stays off.",
        "Other staff review cases in Discord. A moderator capability does not open this page.",
      ]}
    >
      {() => <pre className="preview">{cases}</pre>}
    </DocumentEditor>
  );
}

export function TicketsPage() {
  const auth = useSession();
  const [tickets, setTickets] = useState("Tickets stay hidden until an admin session loads them.");
  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    void fetch("/api/tickets").then(async (response) => {
      setTickets(JSON.stringify(await response.json()));
    });
  }, [auth?.authenticated]);
  return (
    <DocumentEditor
      title="Tickets"
      loadPath="/api/tickets/settings"
      savePath="/api/tickets/settings"
      documentKey="settings"
      sentences={[
        "Ticket settings require an admin session. Staff notes stay out of member transcripts.",
        "Closed tickets follow the stored retention window. Purchase disputes are not resolved from this page.",
      ]}
    >
      {() => <pre className="preview">{tickets}</pre>}
    </DocumentEditor>
  );
}

export function ProgressionPage() {
  const [userId, setUserId] = useState("");
  const [dossier, setDossier] = useState("");
  return (
    <DocumentEditor
      title="Progression"
      loadPath="/api/progression/settings"
      savePath="/api/progression/settings"
      documentKey="settings"
      sentences={[
        "Progression settings, dossiers, and invite history require an admin session.",
        "Public dossier fields stay separate from private notes. Community chat does not grant character points.",
      ]}
    >
      {(session) => (
        <form onSubmit={(event) => {
          event.preventDefault();
          void fetch(`/api/progression/dossier?userId=${encodeURIComponent(userId)}`, {
            headers: { "x-csrf-token": session.csrfToken ?? "" },
          }).then(async (response) => {
            setDossier(JSON.stringify(await response.json()));
          });
        }}>
          <label htmlFor="dossier-user">Member id</label>
          <input id="dossier-user" value={userId} onChange={(event) => setUserId(event.target.value)} />
          <button type="submit">Load dossier</button>
          {dossier ? <pre className="preview">{dossier}</pre> : null}
        </form>
      )}
    </DocumentEditor>
  );
}

export function CommunityPage() {
  const auth = useSession();
  const [view, setView] = useState<Record<string, unknown>>({});
  const [roleId, setRoleId] = useState("");
  const [roleName, setRoleName] = useState("Verified");
  const [assistance, setAssistance] = useState("");
  const [channelId, setChannelId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    void fetch("/api/community/settings").then(async (response) => {
      const body = await response.json() as { settings?: { verifiedRoleId?: string; assistanceChannelId?: string; channels?: Array<{ channelId?: string }> } };
      setView(body as Record<string, unknown>);
      setRoleId(body.settings?.verifiedRoleId ?? "");
      setAssistance(body.settings?.assistanceChannelId ?? "");
      setChannelId(body.settings?.channels?.[0]?.channelId ?? "");
    });
  }, [auth?.authenticated]);

  if (!auth?.authenticated || !auth.csrfToken) {
    return (
      <Closed
        sentences={[
          "Verification, roles, and provider status require an admin session. Missing credentials do not verify a member.",
          "Provider ownership stays setup-required until that provider's key is configured.",
        ]}
      />
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const current = (view["settings"] ?? {}) as Record<string, unknown>;
    const response = await fetch("/api/community/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({
        reason,
        settings: {
          ...current,
          verifiedRoleId: roleId,
          assistanceChannelId: assistance,
          channels: channelId ? [{ channelId, label: "Onboarding", audiences: ["onboarding"] }] : current["channels"],
        },
        roles: [{ id: roleId, name: roleName, position: 1, permissions: "0", managed: false }],
      }),
    });
    const body = await response.json() as { ok?: boolean; errors?: string[] };
    setNotice(body.ok ? "Community settings were saved." : body.errors?.join(" ") || "Community settings were not saved.");
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/community/verification", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ userId: memberId, reason }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result ? `Verification result: ${body.result}.` : "Verification was not changed.");
  }

  return (
    <Shell title="Community">
      <section className="panel">
        <form onSubmit={(event) => void save(event)}>
          <label htmlFor="verified-role">Verified role id</label>
          <input id="verified-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} />
          <label htmlFor="verified-name">Verified role name</label>
          <input id="verified-name" value={roleName} onChange={(event) => setRoleName(event.target.value)} />
          <label htmlFor="assistance-channel">Assistance channel id</label>
          <input id="assistance-channel" value={assistance} onChange={(event) => setAssistance(event.target.value)} />
          <label htmlFor="onboarding-channel">Onboarding channel id</label>
          <input id="onboarding-channel" value={channelId} onChange={(event) => setChannelId(event.target.value)} />
          <label htmlFor="community-reason">Reason</label>
          <textarea id="community-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit">Save access plan</button>
        </form>
        <form onSubmit={(event) => void review(event)}>
          <label htmlFor="review-member">Member id</label>
          <input id="review-member" value={memberId} onChange={(event) => setMemberId(event.target.value)} />
          <button type="submit">Record a manual verification</button>
        </form>
        {notice ? <p role="status">{notice}</p> : null}
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}

export function MarketPage() {
  const auth = useSession();
  const [view, setView] = useState("The market is not loaded.");
  const [baseline, setBaseline] = useState("10000");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    void fetch("/api/market").then(async (response) => {
      setView(JSON.stringify(await response.json(), null, 2));
    });
  }, [auth?.authenticated]);
  if (!auth?.authenticated || !auth.csrfToken) {
    return (
      <Closed
        sentences={[
          "Ingot backing and the scarcity curve require an admin session.",
          "There are 5,000 Ingots. 2,500 stay protected. A curve edit does not mint Marks.",
        ]}
      />
    );
  }
  async function saveCurve(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/market/curve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": auth?.csrfToken ?? "" },
      body: JSON.stringify({ baselineMarks: Number(baseline), reason }),
    });
    const body = await response.json() as { result?: string };
    setNotice(body.result ? `Curve result: ${body.result}.` : "The curve was not saved.");
    const refreshed = await fetch("/api/market");
    setView(JSON.stringify(await refreshed.json(), null, 2));
  }
  return (
    <Shell title="Market">
      <section className="panel">
        <pre className="preview">{view}</pre>
        <form onSubmit={(event) => void saveCurve(event)}>
          <label htmlFor="baseline-marks">Baseline Marks</label>
          <input id="baseline-marks" inputMode="numeric" value={baseline} onChange={(event) => setBaseline(event.target.value)} />
          <label htmlFor="curve-reason">Reason</label>
          <textarea id="curve-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit">Save curve</button>
        </form>
        {notice ? <p role="status">{notice}</p> : null}
        <p><a href="/">Return to the dashboard</a></p>
      </section>
    </Shell>
  );
}

export function SeasonsPage() {
  const auth = useSession();
  const [polls, setPolls] = useState("");
  const [rooms, setRooms] = useState("");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState("Yes, No");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!auth?.authenticated) {
      return;
    }
    void fetch("/api/polls").then(async (response) => setPolls(JSON.stringify(await response.json())));
    void fetch("/api/rooms").then(async (response) => setRooms(JSON.stringify(await response.json())));
  }, [auth?.authenticated]);
  return (
    <DocumentEditor
      title="Seasons"
      loadPath="/api/seasons/settings"
      savePath="/api/seasons/settings"
      documentKey="settings"
      sentences={[
        "Season settings, polls, and temporary rooms require an admin session.",
        "Suggestions are excluded. Rollover keeps wallets, characters, and gear. Rooms close after inactivity.",
      ]}
    >
      {(session, reloadLists) => (
        <>
          <h2>Polls</h2>
          <pre className="preview">{polls || "No polls loaded."}</pre>
          <form onSubmit={(event) => {
            event.preventDefault();
            void fetch("/api/polls", {
              method: "POST",
              headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? "" },
              body: JSON.stringify({ question, choices: choices.split(",").map((choice) => choice.trim()).filter(Boolean), reason, kind: "poll" }),
            }).then(async (response) => {
              const body = await response.json() as { result?: string };
              setNotice(body.result ? `Poll result: ${body.result}.` : "The poll was not created.");
              const listed = await fetch("/api/polls");
              setPolls(JSON.stringify(await listed.json()));
              await reloadLists();
            });
          }}>
            <label htmlFor="poll-question">Question</label>
            <input id="poll-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
            <label htmlFor="poll-choices">Choices</label>
            <input id="poll-choices" value={choices} onChange={(event) => setChoices(event.target.value)} />
            <label htmlFor="poll-reason">Reason</label>
            <textarea id="poll-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            <button type="submit">Create poll</button>
          </form>
          <h2>Rooms</h2>
          <pre className="preview">{rooms || "No rooms loaded."}</pre>
          {notice ? <p role="status">{notice}</p> : null}
        </>
      )}
    </DocumentEditor>
  );
}
