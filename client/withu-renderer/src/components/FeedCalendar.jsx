import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import { t } from "../i18n";
import { desktopBridge } from "../desktop-bridge";

// Local calendar card for the 灵感 page. Everything on it is real: the month
// grid is decorated from the life store (calendar entries plus reminders), the
// day panel lists what is actually scheduled, and creating a reminder writes
// through the same prepare → explicit allow → execute chain the rest of the
// app uses, so the entry shows up in the activity panel's Upcoming tab too.
const pad = (value) => String(value).padStart(2, "0");
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const atMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const localInput = (date) =>
  `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

function hourMinute(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// One row per scheduled record, keyed by local day so the grid can count them.
function scheduleRows(life) {
  if (!life) return [];
  const rows = [];
  for (const reminder of life.reminders || []) {
    if (reminder.status === "deleted") continue;
    rows.push({
      key: "r:" + reminder.id,
      kind: "reminder",
      at: Number(reminder.due_at) * 1000,
      title: reminder.text,
      paused: reminder.status === "paused",
    });
  }
  for (const event of life.calendar || []) {
    rows.push({
      key: "c:" + event.id,
      kind: "calendar",
      at: Number(event.starts_at) * 1000,
      until: Number(event.ends_at) * 1000,
      title: event.title,
    });
  }
  return rows.filter((row) => Number.isFinite(row.at)).sort((a, b) => a.at - b.at);
}

export default function FeedCalendar({ focusDate, onNotice }) {
  const [life, setLife] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState(() => {
    const base = focusDate ? new Date(focusDate) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const [selected, setSelected] = useState(() => atMidnight(focusDate ? new Date(focusDate) : new Date()));
  const [text, setText] = useState("");
  const [time, setTime] = useState(() => {
    const base = focusDate ? new Date(focusDate) : new Date();
    base.setHours(9, 0, 0, 0);
    return localInput(base);
  });

  useEffect(() => {
    if (!focusDate) return;
    const target = new Date(focusDate);
    setView({ year: target.getFullYear(), month: target.getMonth() });
    setSelected(atMidnight(target));
  }, [focusDate]);

  async function load() {
    const bridge = desktopBridge();
    if (!bridge?.lifeList) {
      setError(t("Local schedule unavailable"));
      return;
    }
    try {
      setLife(await bridge.lifeList({ schema_version: 1, scope: "comfort" }));
      setError("");
    } catch (failure) {
      setError(failure?.message || t("Local schedule unavailable"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => scheduleRows(life), [life]);
  const byDay = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      const key = dayKey(new Date(row.at));
      map.set(key, [...(map.get(key) || []), row]);
    }
    return map;
  }, [rows]);

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const offset = (first.getDay() + 6) % 7;
    const total = new Date(view.year, view.month + 1, 0).getDate();
    const list = [];
    for (let index = 0; index < offset; index += 1) list.push(null);
    for (let day = 1; day <= total; day += 1) list.push(new Date(view.year, view.month, day));
    return list;
  }, [view.year, view.month]);

  const today = atMidnight(new Date());
  const selectedRows = byDay.get(dayKey(selected)) || [];
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString([], {
    year: "numeric",
    month: "long",
  });
  const weekdays = useMemo(
    () => [0, 1, 2, 3, 4, 5, 6].map((index) => new Date(2024, 0, 1 + index).toLocaleDateString([], { weekday: "short" })),
    [],
  );

  function shiftMonth(step) {
    setView((current) => {
      const next = new Date(current.year, current.month + step, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  function pick(date) {
    setSelected(date);
    const reminderTime = new Date(date);
    const previous = time ? new Date(time) : null;
    reminderTime.setHours(previous?.getHours() ?? 9, previous?.getMinutes() ?? 0, 0, 0);
    setTime(localInput(reminderTime));
  }

  async function createReminder(event) {
    event.preventDefault();
    const due = new Date(time).getTime();
    if (!text.trim()) {
      setError(t("Please describe the reminder"));
      return;
    }
    if (!Number.isFinite(due) || due <= Date.now()) {
      setError(t("Pick a future time"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const bridge = desktopBridge();
    const base = { schema_version: 1, scope: "comfort" };
    const operationId = crypto.randomUUID();
    try {
      await bridge.lifePrepare({
        ...base,
        operation_id: operationId,
        user_evidence_ref: `feed-reminder:${operationId}`,
        goal_description: t("Create a local reminder"),
        operation: {
          kind: "reminder_create",
          id: crypto.randomUUID(),
          text: text.trim(),
          due_at: Math.floor(due / 1000),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
      });
      await bridge.lifeDecide({ ...base, operation_id: operationId, decision: "allow", explicit_user_allow: true });
      const result = await bridge.lifeExecute({ ...base, operation_id: operationId });
      const status = result?.receipt?.status;
      if (status === "applied") {
        setText("");
        setNotice(t("Reminder saved on this device"));
        // Jump the card to the day that was just written, so the new row and
        // the grid dot appear without hunting for the date.
        const saved = atMidnight(new Date(due));
        setSelected(saved);
        setView({ year: saved.getFullYear(), month: saved.getMonth() });
        await load();
        onNotice?.(t("Reminder saved on this device"));
      } else {
        setError(result?.receipt?.error?.message || t("Reminder was not saved"));
      }
    } catch (failure) {
      setError(failure?.message || t("Reminder was not saved"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="feed-calendar" aria-label={t("Local calendar")}>
      <header className="feed-calendar-head">
        <strong>{monthLabel}</strong>
        <div className="feed-calendar-nav">
          <button type="button" aria-label={t("Previous month")} onClick={() => shiftMonth(-1)}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <button type="button" aria-label={t("Next month")} onClick={() => shiftMonth(1)}>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      </header>
      <div className="feed-calendar-week" aria-hidden="true">
        {weekdays.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="feed-calendar-grid" role="grid">
        {cells.map((date, index) => {
          if (!date) return <span key={"blank" + index} className="feed-calendar-blank" />;
          const key = dayKey(date);
          const count = (byDay.get(key) || []).length;
          const classes = ["feed-calendar-day"];
          if (key === dayKey(selected)) classes.push("is-selected");
          if (key === dayKey(today)) classes.push("is-today");
          return (
            <button
              type="button"
              key={key}
              className={classes.join(" ")}
              aria-pressed={key === dayKey(selected)}
              aria-label={date.toLocaleDateString() + (count ? ` · ${count}` : "")}
              onClick={() => pick(date)}
            >
              <span>{date.getDate()}</span>
              {count > 0 && <i className="feed-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="feed-calendar-panel">
        <h3>{selected.toLocaleDateString([], { month: "long", day: "numeric", weekday: "short" })}</h3>
        {error && <p className="feed-calendar-error" role="alert">{error}</p>}
        {selectedRows.length ? (
          <ul className="feed-calendar-items">
            {selectedRows.map((row) => (
              <li key={row.key}>
                <span className="feed-calendar-time">{hourMinute(row.at)}</span>
                <div>
                  <strong>{row.title}</strong>
                  <small>
                    {row.kind === "reminder" ? t("Reminder") : t("Event")}
                    {row.paused ? " · " + t("Paused") : row.until ? ` · ${hourMinute(row.until)}` : ""}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="feed-calendar-empty">{t("Nothing planned")}</p>
        )}
        <form className="feed-calendar-form" onSubmit={createReminder}>
          <input
            aria-label={t("New reminder")}
            value={text}
            maxLength={512}
            placeholder={t("New reminder")}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="feed-calendar-form-row">
            <input
              type="datetime-local"
              aria-label={t("Reminder time")}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
            <button className="primary" disabled={busy || !text.trim()}>
              {busy ? t("Saving") : t("Create reminder")}
            </button>
          </div>
          {notice && <p className="feed-calendar-notice" role="status">{notice}</p>}
        </form>
      </div>
    </section>
  );
}
