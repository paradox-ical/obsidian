import { Shell } from "@collective/ui";
import { useEffect, useState, type FormEvent } from "react";
import { Route, Routes, useSearchParams } from "react-router";

import { PublicationEditor } from "./publications-editor.js";
import { ActivitiesPage } from "./activities-page.js";
import { CharactersPage } from "./characters-page.js";
import { CombatPage } from "./combat-page.js";
import { WorldPage } from "./world-page.js";
import { ShopPage } from "./shop-page.js";
import { LotteryPage } from "./lottery-page.js";
import { DeadDropPage } from "./dead-drop-page.js";
import { BlackjackPage } from "./blackjack-page.js";
import { CommunityPage, EconomyPage, MarketPage, ModerationPage, ProgressionPage, SeasonsPage, TicketsPage } from "./desk-page.js";
import { ContractsPage } from "./contracts-page.js";
import { GatheringsPage } from "./gatherings-page.js";
import { OperationsPage } from "./operations-page.js";

interface BotHealth {
  database?: string;
  discord?: string;
  jobs?: string;
  foundationRevision?: string | null;
  status?: string;
}

interface AuthStatus {
  authenticated?: boolean;
  oauth?: string;
  access?: string;
  reason?: string;
  csrfToken?: string;
  redirectUri?: string;
}

const SIGN_IN_REASONS: Record<string, string> = {
  denied: "Discord accepted the login, but this account is not the server owner and has no dashboard grant.",
  not_a_member: "That Discord account is not a member of the test server.",
  invalid_code: "Discord rejected the login. The redirect URL below has to match the developer portal exactly, and the client secret has to be the current one.",
  invalid_state: "That login attempt expired. Use Continue with Discord again.",
  directory_unavailable: "Discord could not confirm server membership. The bot has to be in the test server.",
};

const CAPABILITY_LABELS: Record<string, string> = {
  moderation: "Moderation",
  verification_override: "Verification override",
  tickets: "Tickets",
  event_management: "Events",
  economy_operations: "Economy operations",
  publications: "Publications",
  content_management: "Content",
  statistics: "Statistics",
  full_administration: "Full administration",
};

const healthUrl = import.meta.env.VITE_BOT_HEALTH_URL || "http://localhost:8081/health";

const MODULES = [
  { href: "/community", title: "Verification", text: "Members verify in Discord. This page shows provider checks and role grants." },
  { href: "/moderation", title: "Moderation", text: "Cases stay behind this desk. Other staff use Discord. Automatic ban is off." },
  { href: "/tickets", title: "Tickets", text: "Member transcripts omit staff notes. Purchase disputes stay unfinished." },
  { href: "/progression", title: "Progression", text: "Public dossiers show Marks and Ingots. Private bios stay hidden." },
  { href: "/economy", title: "Economy", text: "Edit the routine month here. A preview does not grant Marks." },
  { href: "/market", title: "Market", text: "5,000 Ingots total. 2,500 stay protected. Prices follow the scarcity curve, with no ceiling." },
  { href: "/shop", title: "Shop", text: "The supply shop spends Marks. Steam keys are not crate loot." },
  { href: "/lottery", title: "Lottery", text: "Tickets pool with a reserved 50 percent bonus. The draw time is unset until you save one." },
  { href: "/dead-drop", title: "Dead Drop", text: "A shared 6 by 6 board. The opening hour is unset until you save one." },
  { href: "/blackjack", title: "Blackjack", text: "Solo or social tables. The default maximum bet is 10 Marks." },
  { href: "/characters", title: "Characters", text: "Level cap 50. Respec costs 5,000 Marks. Chat does not grant character points." },
  { href: "/combat", title: "Combat", text: "Test duels use the shared D20 rules. Trades and listings hold gear until they clear." },
  { href: "/world", title: "Regions", text: "Backstreets, Black Docks, and Inner Sanctum. Missions and recovery stay in the database." },
  { href: "/contracts", title: "Contracts", text: "Daily, weekly, and monthly boards. Turning off pings does not stop the reward." },
  { href: "/activities", title: "Activities", text: "Predictions, contests, and giveaways. A missing prize key is not invented." },
  { href: "/gatherings", title: "Events", text: "Official events, RSVP, and crews. A missing token does not create a Discord event." },
  { href: "/seasons", title: "Seasons", text: "Three calendar months. Rollover keeps wallets, characters, and gear. Ranked rating restarts at 1,000." },
  { href: "/publications", title: "Publications", text: "Drafts, review, pins, stickies, and auto replies. Approval binds one revision." },
  { href: "/operations", title: "Operations", text: "Health, jobs, maintenance, versions, and rollback. A draft is not active." },
];

function StaffGrant(props: { csrfToken: string }) {
  const [roleId, setRoleId] = useState("");
  const [capability, setCapability] = useState("economy_operations");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [grants, setGrants] = useState<Array<{ roleId: string; capability: string }>>([]);
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/access/capabilities", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { owner?: boolean; grants?: Array<{ roleId: string; capability: string }> };
        setOwner(body.owner === true);
        setGrants(body.grants ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!owner) {
    return null;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void fetch("/api/access/capabilities", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": props.csrfToken },
      body: JSON.stringify({ roleId, capability, reason }),
    }).then(async (response) => {
      if (!response.ok) {
        setNotice("That role was not granted. Use the role's numeric id and a short reason.");
        return;
      }
      setNotice(`${CAPABILITY_LABELS[capability] ?? capability} now applies to that role.`);
      setGrants((current) => current.some((grant) => grant.roleId === roleId && grant.capability === capability) ? current : [...current, { roleId, capability }]);
    });
  };

  return (
    <form onSubmit={submit}>
      <p>Grant a Discord role the ability to use staff commands. Economy operations is what `/economy adjust` checks. Paste the role id from Discord.</p>
      <label>
        Role id
        <input value={roleId} onChange={(event) => setRoleId(event.target.value)} required />
      </label>
      <label>
        Capability
        <select value={capability} onChange={(event) => setCapability(event.target.value)}>
          {Object.entries(CAPABILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        Reason
        <input value={reason} onChange={(event) => setReason(event.target.value)} required />
      </label>
      <button type="submit">Grant role</button>
      {notice ? <p>{notice}</p> : null}
      {grants.length > 0 ? <p>{grants.map((grant) => `${CAPABILITY_LABELS[grant.capability] ?? grant.capability} on ${grant.roleId}`).join(". ")}.</p> : null}
    </form>
  );
}

function AccessClosed() {
  const [searchParams] = useSearchParams();
  const [health, setHealth] = useState<BotHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [providerLine, setProviderLine] = useState("Provider ownership checks are setup-required.");

  useEffect(() => {
    const controller = new AbortController();
    fetch(healthUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok && response.status !== 503) {
          throw new Error(`Health request failed with status ${response.status}.`);
        }
        setHealth((await response.json()) as BotHealth);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setHealth(null);
        setHealthError("Bot health is unavailable. This is not a successful connection.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then(async (response) => {
        setAuth((await response.json()) as AuthStatus);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setAuth(null);
        setAuthError("Sign-in status is unavailable. This is not a successful login.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/community/providers", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          setProviderLine("Provider ownership checks are setup-required.");
          return;
        }
        const body = (await response.json()) as { providers?: Array<{ provider: string; status: string }> };
        const ready = body.providers?.filter((provider) => provider.status === "ready").length ?? 0;
        const required = body.providers?.filter((provider) => provider.status === "setup_required").length ?? 0;
        setProviderLine(`${ready} provider proofs ready, ${required} setup-required. Handles can still be saved.`);
      })
      .catch(() => {
        setProviderLine("Provider ownership checks are setup-required.");
      });
    return () => controller.abort();
  }, []);

  const oauthLabel = auth?.oauth === "oauth_ready" ? "oauth_ready" : "setup_required";
  const accessLabel = auth?.authenticated ? "allowed" : "denied";
  const signIn = searchParams.get("sign-in");
  const signInMessage = signIn ? SIGN_IN_REASONS[signIn] ?? "Discord sign-in did not open the dashboard." : null;
  const browserOrigin = window.location.origin;
  const redirectOrigin = auth?.redirectUri ? new URL(auth.redirectUri).origin : null;
  const originMismatch = redirectOrigin !== null && redirectOrigin !== browserOrigin;

  return (
    <Shell title={auth?.authenticated ? "Dashboard" : "Sign in"}>
      <div className="card-grid">
        <section className="panel">
          <h2>Access</h2>
          <p>
            {oauthLabel === "oauth_ready"
              ? "Discord sign-in is configured. Opening this page is not a login."
              : "Discord sign-in is not configured yet. Missing credentials do not start a session."}
          </p>
          <p className="status-line">Status: {authError ?? oauthLabel}. Access: {auth?.reason ?? accessLabel}.</p>
          {signInMessage ? <p>{signInMessage}</p> : null}
          {auth?.redirectUri ? <p>Discord redirect: {auth.redirectUri}</p> : null}
          {originMismatch ? <p>This page is {browserOrigin}. Sign-in is set to {redirectOrigin}. Set ADMIN_ORIGIN to this page's address and restart admin.</p> : null}
          {auth?.oauth === "oauth_ready" && !auth.authenticated ? <p><a href="/auth/discord">Continue with Discord</a></p> : null}
          {auth?.authenticated && auth.csrfToken ? (
            <button
              type="button"
              onClick={() => {
                void fetch("/auth/logout", {
                  method: "POST",
                  headers: { "x-csrf-token": auth.csrfToken ?? "" },
                }).then(() => {
                  window.location.assign("/");
                });
              }}
            >
              Log out
            </button>
          ) : null}
        </section>
        <section className="panel">
          <h2>Bot health</h2>
          {healthError ? <p>{healthError}</p> : null}
          {health ? (
            <dl className="facts">
              <div><dt>Process</dt><dd>{health.status ?? "unknown"}</dd></div>
              <div><dt>Database</dt><dd>{health.database ?? "unknown"}</dd></div>
              <div><dt>Discord</dt><dd>{health.discord ?? "unknown"}</dd></div>
              <div><dt>Jobs</dt><dd>{health.jobs ?? "unknown"}</dd></div>
              <div><dt>Revision</dt><dd>{health.foundationRevision ?? "none"}</dd></div>
            </dl>
          ) : healthError ? null : <p>Health has not loaded.</p>}
          <p>{providerLine}</p>
        </section>
        {MODULES.map((module) => (
          <section className="panel" key={module.href}>
            <h2>{module.title}</h2>
            <p>{module.text}</p>
            <a className="card-link" href={module.href}>Open {module.title}</a>
          </section>
        ))}
      </div>
      {auth?.authenticated && auth.csrfToken ? (
        <section className="panel">
          <h2>Staff roles</h2>
          <StaffGrant csrfToken={auth.csrfToken} />
        </section>
      ) : null}
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/publications" element={<PublicationEditor />} />
      <Route path="/gatherings" element={<GatheringsPage />} />
      <Route path="/activities" element={<ActivitiesPage />} />
      <Route path="/contracts" element={<ContractsPage />} />
      <Route path="/characters" element={<CharactersPage />} />
      <Route path="/combat" element={<CombatPage />} />
      <Route path="/world" element={<WorldPage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/lottery" element={<LotteryPage />} />
      <Route path="/dead-drop" element={<DeadDropPage />} />
      <Route path="/blackjack" element={<BlackjackPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/moderation" element={<ModerationPage />} />
      <Route path="/tickets" element={<TicketsPage />} />
      <Route path="/progression" element={<ProgressionPage />} />
      <Route path="/economy" element={<EconomyPage />} />
      <Route path="/market" element={<MarketPage />} />
      <Route path="/seasons" element={<SeasonsPage />} />
      <Route path="/operations" element={<OperationsPage />} />
      <Route path="*" element={<AccessClosed />} />
    </Routes>
  );
}
