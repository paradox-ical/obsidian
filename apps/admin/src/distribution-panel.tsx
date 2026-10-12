import { useEffect, useState } from "react";

interface SeriesRow {
  id: string;
  cadence: string;
  timezone: string;
  status: string;
  nextRunAt: string;
  destination: string;
}

interface DeliveryRow {
  id: string;
  seriesId: string;
  occurrenceKey: string;
  status: string;
  delivery: string;
}

interface Board {
  result?: string;
  series?: SeriesRow[];
  deliveries?: DeliveryRow[];
  alerts?: Array<{ id: string; kind: string; reason: string; delivery: string }>;
}

export function DistributionPanel({ csrfToken, draftId }: { csrfToken: string; draftId: string }) {
  const [board, setBoard] = useState<Board>({});
  const [notice, setNotice] = useState("");
  const [destination, setDestination] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [timezone, setTimezone] = useState("Australia/Perth");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [weekday, setWeekday] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [scheduledFor, setScheduledFor] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [removeAfterMinutes, setRemoveAfterMinutes] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [pinExpiry, setPinExpiry] = useState("");
  const [pinId, setPinId] = useState("");
  const [stickyChannel, setStickyChannel] = useState("");
  const [stickyContent, setStickyContent] = useState("");
  const [stickyThreshold, setStickyThreshold] = useState("5");
  const [stickyCooldown, setStickyCooldown] = useState("60000");
  const [replyName, setReplyName] = useState("");
  const [replyKind, setReplyKind] = useState("trigger");
  const [replyPattern, setReplyPattern] = useState("!server");
  const [replyVariants, setReplyVariants] = useState("The gate is east.");
  const [replyVisibility, setReplyVisibility] = useState("channel");
  const [replyPriority, setReplyPriority] = useState("0");
  const [replyExcluded, setReplyExcluded] = useState("");
  const [replyText, setReplyText] = useState("!server");
  const [replySource, setReplySource] = useState("message");
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedMode, setFeedMode] = useState("approval");
  const [feedDestination, setFeedDestination] = useState("");
  const [feedId, setFeedId] = useState("");
  const [feedPayload, setFeedPayload] = useState("");

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  async function reload() {
    const response = await fetch("/api/distribution");
    setBoard((await response.json()) as Board);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/distribution", { signal: controller.signal })
      .then(async (response) => setBoard((await response.json()) as Board))
      .catch(() => setBoard({}));
    return () => controller.abort();
  }, []);

  return (
    <section className="panel editor-grid">
      <h2>Announcements, pins, stickies, replies, and feeds</h2>
      <p>Each occurrence is a new message. Discord delivery stays setup-required until a bot token can post it. A missing feed is left unavailable and is not turned into a new update.</p>
      {notice ? <p role="status">{notice}</p> : null}
      <h3>Calendar</h3>
      <ul>
        {(board.series ?? []).map((series) => (
          <li key={series.id}>{series.cadence} {series.timezone} {series.status} next {series.nextRunAt} to {series.destination}</li>
        ))}
      </ul>
      <h3>Delivery history</h3>
      <ul>
        {(board.deliveries ?? []).map((delivery) => (
          <li key={delivery.id}>{delivery.occurrenceKey} {delivery.status} {delivery.delivery}</li>
        ))}
      </ul>
      <h3>Failure alerts</h3>
      <ul>
        {(board.alerts ?? []).map((alert) => (
          <li key={alert.id}>{alert.kind}: {alert.reason} ({alert.delivery})</li>
        ))}
      </ul>
      <h3>Schedule</h3>
      <label htmlFor="dist-destination">Destination<input id="dist-destination" value={destination} onChange={(event) => setDestination(event.target.value)} /></label>
      <label htmlFor="dist-cadence">Cadence
        <select id="dist-cadence" value={cadence} onChange={(event) => setCadence(event.target.value)}>
          <option value="once">One-off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label htmlFor="dist-timezone">Timezone<input id="dist-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
      <label htmlFor="dist-hour">Hour<input id="dist-hour" value={hour} onChange={(event) => setHour(event.target.value)} /></label>
      <label htmlFor="dist-minute">Minute<input id="dist-minute" value={minute} onChange={(event) => setMinute(event.target.value)} /></label>
      <label htmlFor="dist-weekday">Weekday<input id="dist-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)} /></label>
      <label htmlFor="dist-day">Day of month<input id="dist-day" value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} /></label>
      <label htmlFor="dist-when">One-off time<input id="dist-when" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></label>
      <label htmlFor="dist-ends">End date<input id="dist-ends" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
      <label htmlFor="dist-remove">Remove after minutes<input id="dist-remove" value={removeAfterMinutes} onChange={(event) => setRemoveAfterMinutes(event.target.value)} /></label>
      <button type="button" onClick={() => void schedule()}>Schedule approved draft</button>
      <label htmlFor="dist-series">Series<input id="dist-series" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} /></label>
      <button type="button" onClick={() => void act("/api/distribution/announcement/pause")}>Pause</button>
      <button type="button" onClick={() => void act("/api/distribution/announcement/resume")}>Resume</button>
      <button type="button" onClick={() => void reschedule()}>Reschedule</button>
      <button type="button" onClick={() => void act("/api/distribution/announcement/cancel")}>Cancel</button>
      <h3>Pins</h3>
      <label htmlFor="dist-message">Message<input id="dist-message" value={messageId} onChange={(event) => setMessageId(event.target.value)} /></label>
      <label htmlFor="dist-pin-expiry">Pin expiry<input id="dist-pin-expiry" value={pinExpiry} onChange={(event) => setPinExpiry(event.target.value)} /></label>
      <button type="button" onClick={() => void pin()}>Pin</button>
      <label htmlFor="dist-pin">Pin id<input id="dist-pin" value={pinId} onChange={(event) => setPinId(event.target.value)} /></label>
      <button type="button" onClick={() => void unpin()}>Remove pin</button>
      <h3>Sticky</h3>
      <label htmlFor="dist-sticky-channel">Channel<input id="dist-sticky-channel" value={stickyChannel} onChange={(event) => setStickyChannel(event.target.value)} /></label>
      <label htmlFor="dist-sticky-content">Sticky text<textarea id="dist-sticky-content" value={stickyContent} onChange={(event) => setStickyContent(event.target.value)} /></label>
      <label htmlFor="dist-sticky-threshold">Human messages<input id="dist-sticky-threshold" value={stickyThreshold} onChange={(event) => setStickyThreshold(event.target.value)} /></label>
      <label htmlFor="dist-sticky-cooldown">Cooldown ms<input id="dist-sticky-cooldown" value={stickyCooldown} onChange={(event) => setStickyCooldown(event.target.value)} /></label>
      <button type="button" onClick={() => void saveStickyChannel()}>Save sticky</button>
      <h3>Auto reply</h3>
      <label htmlFor="dist-reply-name">Name<input id="dist-reply-name" value={replyName} onChange={(event) => setReplyName(event.target.value)} /></label>
      <label htmlFor="dist-reply-kind">Kind
        <select id="dist-reply-kind" value={replyKind} onChange={(event) => setReplyKind(event.target.value)}>
          <option value="exact">Exact</option>
          <option value="keyword">Keyword</option>
          <option value="pattern">Pattern</option>
          <option value="trigger">Trigger</option>
        </select>
      </label>
      <label htmlFor="dist-reply-pattern">Pattern<input id="dist-reply-pattern" value={replyPattern} onChange={(event) => setReplyPattern(event.target.value)} /></label>
      <label htmlFor="dist-reply-variants">Variants<textarea id="dist-reply-variants" value={replyVariants} onChange={(event) => setReplyVariants(event.target.value)} /></label>
      <label htmlFor="dist-reply-visibility">Visibility
        <select id="dist-reply-visibility" value={replyVisibility} onChange={(event) => setReplyVisibility(event.target.value)}>
          <option value="channel">Channel</option>
          <option value="dm">Direct message</option>
          <option value="ephemeral">Ephemeral interaction</option>
        </select>
      </label>
      <label htmlFor="dist-reply-priority">Priority<input id="dist-reply-priority" value={replyPriority} onChange={(event) => setReplyPriority(event.target.value)} /></label>
      <label htmlFor="dist-reply-excluded">Excluded channels<input id="dist-reply-excluded" value={replyExcluded} onChange={(event) => setReplyExcluded(event.target.value)} /></label>
      <button type="button" onClick={() => void saveReply()}>Save reply rule</button>
      <label htmlFor="dist-reply-text">Test text<input id="dist-reply-text" value={replyText} onChange={(event) => setReplyText(event.target.value)} /></label>
      <label htmlFor="dist-reply-source">Test source
        <select id="dist-reply-source" value={replySource} onChange={(event) => setReplySource(event.target.value)}>
          <option value="message">Ordinary message</option>
          <option value="interaction">Interaction</option>
        </select>
      </label>
      <button type="button" onClick={() => void testReply()}>Test reply</button>
      <h3>Game updates</h3>
      <label htmlFor="dist-feed-name">Source name<input id="dist-feed-name" value={feedName} onChange={(event) => setFeedName(event.target.value)} /></label>
      <label htmlFor="dist-feed-url">Feed URL<input id="dist-feed-url" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} /></label>
      <label htmlFor="dist-feed-mode">Mode
        <select id="dist-feed-mode" value={feedMode} onChange={(event) => setFeedMode(event.target.value)}>
          <option value="automatic">Automatic</option>
          <option value="approval">Approval queue</option>
        </select>
      </label>
      <label htmlFor="dist-feed-destination">Destination<input id="dist-feed-destination" value={feedDestination} onChange={(event) => setFeedDestination(event.target.value)} /></label>
      <button type="button" onClick={() => void saveFeed()}>Save feed</button>
      <label htmlFor="dist-feed-id">Feed id<input id="dist-feed-id" value={feedId} onChange={(event) => setFeedId(event.target.value)} /></label>
      <label htmlFor="dist-feed-payload">Supplied payload<textarea id="dist-feed-payload" value={feedPayload} onChange={(event) => setFeedPayload(event.target.value)} /></label>
      <button type="button" onClick={() => void pollFeed()}>Poll supplied payload</button>
      <button type="button" onClick={() => void reload()}>Refresh</button>
    </section>
  );

  async function schedule() {
    const body = await post("/api/distribution/announcement", {
      draftId,
      destination,
      cadence,
      timezone,
      hour: Number(hour),
      minute: Number(minute),
      weekday: cadence === "weekly" ? Number(weekday) : null,
      dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : null,
      scheduledFor: scheduledFor || null,
      endsAt: endsAt || null,
      removeAfterMinutes: removeAfterMinutes ? Number(removeAfterMinutes) : null,
    });
    setNotice(typeof body["result"] === "string" ? `Announcement ${body["result"]}.` : "The announcement was not scheduled.");
    const series = body["series"];
    if (series && typeof series === "object" && "id" in series && typeof series.id === "string") {
      setSeriesId(series.id);
    }
    await reload();
  }

  async function act(path: string) {
    const body = await post(path, { seriesId });
    setNotice(typeof body["result"] === "string" ? `Series ${body["result"]}.` : "The series was not changed.");
    await reload();
  }

  async function reschedule() {
    const body = await post("/api/distribution/announcement/reschedule", {
      seriesId,
      timezone,
      hour: Number(hour),
      minute: Number(minute),
      weekday: cadence === "weekly" ? Number(weekday) : null,
      dayOfMonth: cadence === "monthly" ? Number(dayOfMonth) : null,
      endsAt: endsAt || null,
      scheduledFor: scheduledFor || null,
    });
    setNotice(typeof body["result"] === "string" ? `Reschedule ${body["result"]}.` : "The series was not rescheduled.");
    await reload();
  }

  async function pin() {
    const body = await post("/api/distribution/pin", { messageId, expiresAt: pinExpiry || null });
    setNotice(typeof body["result"] === "string" ? `Pin ${body["result"]}.` : "The pin was not recorded.");
    const pinRow = body["pin"];
    if (pinRow && typeof pinRow === "object" && "id" in pinRow && typeof pinRow.id === "string") {
      setPinId(pinRow.id);
    }
    await reload();
  }

  async function unpin() {
    const body = await post("/api/distribution/unpin", { pinId });
    setNotice(typeof body["result"] === "string" ? `Pin ${body["result"]}.` : "The pin was not removed.");
    await reload();
  }

  async function saveStickyChannel() {
    const body = await post("/api/distribution/sticky", {
      channelId: stickyChannel,
      content: stickyContent,
      threshold: Number(stickyThreshold),
      cooldownMs: Number(stickyCooldown),
    });
    setNotice(typeof body["result"] === "string" ? `Sticky ${body["result"]}.` : "The sticky was not saved.");
    await reload();
  }

  async function saveReply() {
    const body = await post("/api/distribution/reply", {
      name: replyName,
      kind: replyKind,
      pattern: replyPattern,
      variants: replyVariants.split("\n").map((line) => line.trim()).filter((line) => line.length > 0),
      visibility: replyVisibility,
      priority: Number(replyPriority),
      excludedChannelIds: replyExcluded.split(/[\s,]+/).filter((entry) => entry.length > 0),
      channelIds: [],
      roleIds: [],
      excludedRoleIds: [],
      secret: false,
      cooldownMs: 0,
      status: "active",
    });
    setNotice(typeof body["result"] === "string" ? `Reply ${body["result"]}.` : "The reply rule was not saved.");
    await reload();
  }

  async function testReply() {
    const body = await post("/api/distribution/reply/test", {
      text: replyText,
      source: replySource,
      channelId: stickyChannel || destination,
      roleIds: [],
      authorIsBot: false,
      pick: 0,
    });
    const selected = body["selected"];
    if (body["sent"] !== false) {
      setNotice("The dashboard test must not send a reply.");
      return;
    }
    setNotice(selected && typeof selected === "object" ? `Reply test ${JSON.stringify(selected)}.` : "The reply test did not run.");
  }

  async function saveFeed() {
    const body = await post("/api/distribution/feed", {
      sourceId: feedId || null,
      name: feedName,
      adapter: "json",
      url: feedUrl,
      mode: feedMode,
      destination: feedDestination,
      status: "active",
    });
    setNotice(typeof body["result"] === "string" ? `Feed ${body["result"]}.` : "The feed was not saved.");
    const source = body["source"];
    if (source && typeof source === "object" && "id" in source && typeof source.id === "string") {
      setFeedId(source.id);
    }
    await reload();
  }

  async function pollFeed() {
    let payload: unknown;
    if (feedPayload.trim()) {
      try {
        payload = JSON.parse(feedPayload) as unknown;
      } catch {
        setNotice("The supplied payload is not JSON. Nothing was invented.");
        return;
      }
    }
    const body = await post("/api/distribution/feed/poll", feedPayload.trim() ? { sourceId: feedId, payload } : { sourceId: feedId });
    setNotice(typeof body["result"] === "string" ? `Feed poll ${body["result"]}.` : "The feed was not polled.");
    await reload();
  }
}
