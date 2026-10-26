import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { t } from "../i18n";
import { desktopBridge } from "../desktop-bridge";
import DateCalendar from "./DatePicker";
import TimeField from "./TimeField";
import "./Schedule.css";

const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 128;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
/* 期历几何锁定：列宽和行高都是固定像素，不随窗口压缩。
   窗口变宽就往右边多排日期（dayCount 跟着板宽涨），变窄到 7 列以下出横向滚动；
   窗口变高只是视口里能看到更多时间行（行高不变，靠滚动）。 */
const COL_W = 150;
const GUTTER_W = 54;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const pad = (value) => String(value).padStart(2, "0");

const atMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, amount) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const weekStart = (date) => addDays(atMidnight(date), -atMidnight(date).getDay());
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sameDay = (a, b) => dayKey(a) === dayKey(b);
/* Reference-style 12-hour labels: gutter "9 AM" / "12 PM" / "1 PM". */
const hourLabel = (hour) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
/* Compact card time: "1:30 – 2 PM" (minutes dropped on the hour). */
const hm12 = (at) => {
  const date = new Date(at);
  const hour = date.getHours();
  return `${hour % 12 === 0 ? 12 : hour % 12}${date.getMinutes() ? `:${pad(date.getMinutes())}` : ""}`;
};
const meridiem = (at) => (new Date(at).getHours() < 12 ? "AM" : "PM");
const localInput = (date) => `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

function scheduledRows(life) {
  if (!life) return [];
  const rows = [];
  for (const reminder of life.reminders || []) {
    if (reminder.status === "deleted") continue;
    rows.push({
      key: "reminder:" + reminder.id,
      kind: "reminder",
      refId: reminder.id,
      version: Number(reminder.version) || 0,
      title: reminder.text,
      at: Number(reminder.due_at) * 1000,
      until: null,
      paused: reminder.status === "paused",
    });
  }
  for (const event of life.calendar || []) {
    rows.push({
      key: "calendar:" + event.id,
      kind: "event",
      refId: event.id,
      version: Number(event.version) || 0,
      title: event.title,
      at: Number(event.starts_at) * 1000,
      until: Number(event.ends_at) * 1000,
      paused: false,
    });
  }
  return rows.filter((row) => Number.isFinite(row.at)).sort((a, b) => a.at - b.at);
}

function layOutDay(rows, day) {
  const visibleStart = atMidnight(day).getTime();
  const visibleEnd = +addDays(day, 1);
  const items = rows
    .map((row) => ({ ...row, end: row.until > row.at ? row.until : row.at + 30 * 60000 }))
    .filter((row) => row.at < visibleEnd && row.end > visibleStart)
    .map((row) => ({ ...row, from: Math.max(row.at, visibleStart), to: Math.min(row.end, visibleEnd) }))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  // 同一时间的卡片上下排列：每张卡都从自己的时间点开始，和上一张的底边
  // 相撞就往下顺延；时段太矮放不下内容时按内容撑开（emoji + 标题行数 + 时间），
  // 不再出现省略号，也不用并排挤在一条泳道里。
  const placed = [];
  let cursor = -Infinity;
  for (const item of items) {
    const slotH = ((item.to - item.from) / 3600000) * HOUR_HEIGHT;
    const titleLines = Math.max(1, Math.ceil((item.title || "").length / 9));
    const contentH = 16 + 18 + titleLines * 16 + 13 + 8;
    const top = Math.max(
      Math.max(0, ((item.from - visibleStart) / 3600000 - START_HOUR) * HOUR_HEIGHT),
      cursor,
    );
    const height = Math.max(slotH - 2, contentH, 46);
    placed.push({ ...item, top, height });
    cursor = top + height + 2;
  }
  return placed;
}

function cardTitle(title) {
  const match = String(title || "").match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u);
  return { symbol: match?.[1], text: match ? title.slice(match[0].length) : title };
}

/* Sidebar row: a real toggle button for the done mark plus a separate button
   that opens the detail dropdown. Hover reveals pin / trash, same as the
   conversation list: pin sorts the row to the top, trash deletes it. */
function SideRow({ row, done, busy, pinned, onToggle, onOpen, onPin, onDelete }) {
  return (
    <div className="sched-side-row">
      <button
        type="button"
        className={"sched-check" + (done ? " is-done" : "")}
        role="checkbox"
        aria-checked={done}
        aria-busy={busy || undefined}
        disabled={busy}
        aria-label={done ? `将「${row.title}」标记为未完成` : `将「${row.title}」标记为已完成`}
        onClick={() => onToggle(row)}
      >
        {done && (
          <svg
            viewBox="0 0 24 24"
            width={12}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5.2 12.4 9.6 16.8 18.8 7" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={"sched-side-copy" + (done ? " is-done" : "")}
        onClick={(event) => onOpen(row, event.currentTarget)}
      >
        <strong>{row.title}</strong>
      </button>
      <span className="sched-side-actions">
        <button
          type="button"
          className={"sched-side-action" + (pinned ? " is-pinned" : "")}
          aria-label={(pinned ? "取消置顶" : "置顶") + `「${row.title}」`}
          title={pinned ? "取消置顶" : "置顶"}
          disabled={busy}
          onClick={() => onPin(row)}
        >
          <Icon name="pin" size={13} />
        </button>
        <button
          type="button"
          className="sched-side-action sched-side-delete"
          aria-label={`删除「${row.title}」`}
          title="删除"
          disabled={busy}
          onClick={() => onDelete(row)}
        >
          <Icon name="trash" size={13} />
        </button>
      </span>
    </div>
  );
}

export default function Schedule({ focusDate, onNotice }) {
  const [life, setLife] = useState(null);
  const [error, setError] = useState("");
  const [today, setToday] = useState(() => atMidnight(new Date()));
  const [anchor, setAnchor] = useState(() => weekStart(focusDate ? new Date(focusDate) : new Date()));
  // 板宽用 ResizeObserver 实测：列数 = 板宽能放下几列就排几列，最少 7 列。
  const boardRef = useRef(null);
  const headClipRef = useRef(null);
  const [boardW, setBoardW] = useState(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setBoardW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dayCount = Math.max(7, Math.round((boardW - GUTTER_W) / COL_W));
  const boardInnerW = GUTTER_W + dayCount * COL_W;
  const [selectedDay, setSelectedDay] = useState(() => atMidnight(focusDate ? new Date(focusDate) : new Date()));
  const [sideTab, setSideTab] = useState("todo");
  const [collapsed, setCollapsed] = useState({});
  const [visibleKinds, setVisibleKinds] = useState({ reminder: true, event: true });
  const [compose, setCompose] = useState(null);
  const [detail, setDetail] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  /* Session-local done marks: events have no backend complete op, and the
     mark also mirrors the optimistic toggle while a reminder pause/resume
     round-trip is in flight. */
  const [localDone, setLocalDone] = useState(() => new Set());
  const [busyKey, setBusyKey] = useState(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const titleInput = useRef(null);
  const scrollRef = useRef(null);
  const menuRef = useRef(null);
  const detailEl = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setToday(atMidnight(new Date())), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!focusDate) return;
    const target = new Date(focusDate);
    setAnchor(weekStart(target));
    setSelectedDay(atMidnight(target));
  }, [focusDate]);

  async function load() {
    const bridge = desktopBridge();
    if (!bridge?.lifeList) {
      setError("本地日程不可用");
      return;
    }
    try {
      setLife(await bridge.lifeList({ schema_version: 1, scope: "comfort" }));
      setError("");
    } catch (failure) {
      setError(failure?.message || "本地日程不可用");
    }
  }

  useEffect(() => {
    void load();
    // 聊天审批卡允许/取消后生活数据已变化，这里跟着重拉，保持日历即时可见。
    const reload = () => void load();
    window.addEventListener("withu:life:changed", reload);
    return () => window.removeEventListener("withu:life:changed", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (compose) window.setTimeout(() => titleInput.current?.focus(), 40);
  }, [compose]);

  /* Open the board around the working morning, like the reference. */
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = 8 * HOUR_HEIGHT;
  }, []);

  const rows = useMemo(() => scheduledRows(life), [life]);
  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => addDays(anchor, index)), [anchor, dayCount]);
  const weekRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          visibleKinds[row.kind] &&
          row.at >= +anchor &&
          row.at < +addDays(anchor, dayCount),
      ),
    [rows, anchor, visibleKinds, dayCount],
  );
  const todayWeek = useMemo(() => weekStart(today), [today]);
  // 置顶跟会话列表同一套交互：钉过的排最前，记在 localStorage。
  const [pinned, setPinned] = useState(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem("withu.pinnedReminders") || "[]");
      return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const togglePin = (row) => {
    setPinned((value) => {
      const next = value.includes(row.key) ? value.filter((id) => id !== row.key) : [row.key, ...value];
      try { window.localStorage.setItem("withu.pinnedReminders", JSON.stringify(next)); } catch { /* 隐私模式存不了就算了 */ }
      return next;
    });
  };
  const pinSort = (list) =>
    [...list].sort((a, b) => Number(pinned.includes(b.key)) - Number(pinned.includes(a.key)) || a.at - b.at);
  const thisWeek = useMemo(
    () => pinSort(rows.filter((row) => visibleKinds[row.kind] && row.at >= +todayWeek && row.at < +addDays(todayWeek, 7))),
    [rows, todayWeek, visibleKinds, pinned],
  );
  const later = useMemo(
    () =>
      pinSort(
        rows.filter(
          (row) =>
            visibleKinds[row.kind] &&
            row.at >= +addDays(todayWeek, 7) &&
            row.at < +new Date(todayWeek.getFullYear(), todayWeek.getMonth() + 1, 1),
        ),
      ),
    [rows, todayWeek, visibleKinds, pinned],
  );
  const monthRows = useMemo(
    () =>
      pinSort(
        rows.filter((row) => {
          if (!visibleKinds[row.kind]) return false;
          const date = new Date(row.at);
          return date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth();
        }),
      ),
    [rows, anchor, visibleKinds, pinned],
  );
  const sideRows = sideTab === "todo" ? thisWeek : monthRows;
  const nextRows = sideTab === "todo" ? later : [];
  const weekLabel = useMemo(() => {
    const first = days[0];
    const last = days[days.length - 1];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getMonth() + 1}月${first.getDate()}日 – ${last.getDate()}日`;
    }
    return `${first.getMonth() + 1}月${first.getDate()}日 – ${last.getMonth() + 1}月${last.getDate()}日`;
  }, [days]);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const nowTop = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

  const toggleGroup = (key) => setCollapsed((value) => ({ ...value, [key]: !value[key] }));

  function shiftWeek(step) {
    const next = addDays(anchor, step * 7);
    setDetail(null);
    setAnchor(next);
    setSelectedDay(atMidnight(addDays(selectedDay, step * 7)));
  }

  function goToday() {
    const current = atMidnight(new Date());
    setDetail(null);
    setToday(current);
    setAnchor(weekStart(current));
    setSelectedDay(current);
  }

  function openCompose(day = selectedDay, minutes = 9 * 60) {
    setDetail(null);
    let start = new Date(day);
    start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    if (start.getTime() <= Date.now()) {
      start = new Date(Date.now() + 30 * 60000);
      start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    }
    setTitle("");
    setWhen(localInput(start));
    setFormError("");
    setCompose({ day: atMidnight(start) });
  }

  function pickSlot(day, event) {
    if (event.target.closest(".sched-event")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const rawMinutes = START_HOUR * 60 + (offset / HOUR_HEIGHT) * 60;
    const minutes = Math.round(rawMinutes / 30) * 30;
    setSelectedDay(atMidnight(day));
    openCompose(day, minutes);
  }

  async function createReminder(event) {
    event.preventDefault();
    const due = new Date(when).getTime();
    if (!title.trim()) {
      setFormError("请输入日程标题");
      return;
    }
    if (!Number.isFinite(due) || due <= Date.now()) {
      setFormError("请选择一个未来的时间");
      return;
    }
    const bridge = desktopBridge();
    if (!bridge?.lifePrepare) {
      setFormError("本地日程不可用");
      return;
    }
    setSaving(true);
    setFormError("");
    const base = { schema_version: 1, scope: "comfort" };
    const operationId = crypto.randomUUID();
    try {
      await bridge.lifePrepare({
        ...base,
        operation_id: operationId,
        user_evidence_ref: `schedule:${operationId}`,
        goal_description: "创建本地日程",
        operation: {
          kind: "reminder_create",
          id: crypto.randomUUID(),
          text: title.trim(),
          due_at: Math.floor(due / 1000),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
      });
      await bridge.lifeDecide({ ...base, operation_id: operationId, decision: "allow", explicit_user_allow: true });
      const result = await bridge.lifeExecute({ ...base, operation_id: operationId });
      if (result?.receipt?.status === "applied") {
        const saved = atMidnight(new Date(due));
        setCompose(null);
        setAnchor(weekStart(saved));
        setSelectedDay(saved);
        setNotice("日程已保存到这台设备");
        await load();
        onNotice?.("日程已保存到这台设备");
      } else {
        setFormError(result?.receipt?.error?.message || "日程未保存");
      }
    } catch (failure) {
      setFormError(failure?.message || "日程未保存");
    } finally {
      setSaving(false);
    }
  }

  /* ── Done marks ───────────────────────────────────────────────────────────
     Reminders persist through the backend pause/resume pair (the only
     completion-shaped operations withu-life exposes); calendar events have no
     such op, so their mark is session-local. */
  function isDone(row) {
    return Boolean(row.paused || localDone.has(row.key));
  }

  async function toggleDone(row) {
    if (busyKey === row.key) return;
    const done = isDone(row);
    const key = row.key;
    setDetail(null);
    setLocalDone((value) => {
      const next = new Set(value);
      if (done) next.delete(key);
      else next.add(key);
      return next;
    });
    if (row.kind !== "reminder") return;
    const bridge = desktopBridge();
    if (!bridge?.lifePrepare) return;
    const base = { schema_version: 1, scope: "comfort" };
    const operationId = crypto.randomUUID();
    setBusyKey(key);
    try {
      await bridge.lifePrepare({
        ...base,
        operation_id: operationId,
        user_evidence_ref: `schedule:${operationId}`,
        goal_description: done ? "恢复本地提醒" : "完成本地提醒",
        operation: done
          ? { kind: "reminder_resume", id: row.refId, expected_version: row.version }
          : { kind: "reminder_pause", id: row.refId, expected_version: row.version },
      });
      await bridge.lifeDecide({ ...base, operation_id: operationId, decision: "allow", explicit_user_allow: true });
      const result = await bridge.lifeExecute({ ...base, operation_id: operationId });
      if (result?.receipt?.status !== "applied") {
        throw new Error(result?.receipt?.error?.message || "操作未保存");
      }
      setLocalDone((value) => {
        const next = new Set(value);
        next.delete(key);
        return next;
      });
      await load();
      setNotice(done ? "提醒已恢复" : "已标记完成，提醒已暂停");
      onNotice?.(done ? "提醒已恢复" : "已标记完成");
    } catch (failure) {
      setLocalDone((value) => {
        const next = new Set(value);
        if (done) next.add(key);
        else next.delete(key);
        return next;
      });
      setError(failure?.message || "操作未保存");
    } finally {
      setBusyKey(null);
    }
  }

  // 删除：与置顶并列的垃圾桶入口，走同一条 prepare → allow → execute 链路。
  async function deleteRow(row) {
    const bridge = desktopBridge();
    if (!bridge?.lifePrepare) {
      setError("本地日程不可用");
      return;
    }
    const base = { schema_version: 1, scope: "comfort" };
    const operationId = crypto.randomUUID();
    setBusyKey(row.key);
    try {
      await bridge.lifePrepare({
        ...base,
        operation_id: operationId,
        user_evidence_ref: `schedule:${operationId}`,
        goal_description: "删除本地日程",
        operation:
          row.kind === "reminder"
            ? { kind: "reminder_delete", id: row.refId, expected_version: row.version }
            : { kind: "calendar_delete", id: row.refId, expected_version: row.version },
      });
      await bridge.lifeDecide({ ...base, operation_id: operationId, decision: "allow", explicit_user_allow: true });
      const result = await bridge.lifeExecute({ ...base, operation_id: operationId });
      if (result?.receipt?.status !== "applied") {
        throw new Error(result?.receipt?.error?.message || "删除未保存");
      }
      setPinned((value) => {
        const next = value.filter((id) => id !== row.key);
        try { window.localStorage.setItem("withu.pinnedReminders", JSON.stringify(next)); } catch { /* 同上 */ }
        return next;
      });
      await load();
      setNotice("日程已删除");
      onNotice?.("日程已删除");
    } catch (failure) {
      setError(failure?.message || "删除未保存");
    } finally {
      setBusyKey(null);
    }
  }

  /* ── Row detail dropdown ─────────────────────────────────────────────────
     A small popover anchored to the clicked row: no backdrop, closes on
     outside click / Esc / scroll / resize, clamped inside the viewport. */
  function openRow(row, element) {
    if (detail && detail.row.key === row.key) {
      setDetail(null);
      return;
    }
    detailEl.current = element;
    setMenuPos(null);
    setDetail({ row, rect: element.getBoundingClientRect() });
  }

  function jumpToRow(row) {
    const target = atMidnight(new Date(row.at));
    setSelectedDay(target);
    setAnchor(weekStart(target));
    const node = scrollRef.current;
    if (node) {
      const hours = (row.at - +target) / 3600000;
      const top = (hours - 1) * HOUR_HEIGHT;
      node.scrollTop = Math.max(0, Math.min(top, GRID_HEIGHT + 24 - node.clientHeight));
    }
    setDetail(null);
  }

  /* Anchor the dropdown once per open: flip left/below/above when the
     preferred spot would overflow the viewport. */
  useLayoutEffect(() => {
    if (!detail || !menuRef.current) return;
    const menu = menuRef.current;
    menu.focus({ preventScroll: true });
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const rect = detail.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + 8;
    let top = rect.top - 8;
    if (left + width > vw - 8) left = rect.left - width - 8;
    if (left < 8) {
      left = Math.min(Math.max(8, rect.left), Math.max(8, vw - width - 8));
      top = rect.bottom + 6;
      if (top + height > vh - 8) top = rect.top - height - 6;
    }
    left = Math.min(Math.max(8, left), Math.max(8, vw - width - 8));
    top = Math.min(Math.max(8, top), Math.max(8, vh - height - 8));
    setMenuPos({ left, top });
  }, [detail]);

  useEffect(() => {
    if (!detail) return;
    const close = () => setDetail(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    const onMouseDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (detailEl.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [detail]);

  return (
    <main className="schedule-page">
      <header className="sched-header">
        <div className="sched-title">
          <h1>{t("Calendar")}</h1>
          <span className="sched-month">
            {anchor.getFullYear()}年{anchor.getMonth() + 1}月
            <i />
            {weekLabel}
          </span>
        </div>
        <div className="sched-actions">
          <button type="button" className="sched-today" onClick={goToday}>
            {t("Today")}
          </button>
          <div className="sched-stepper">
            <button type="button" aria-label="上一周" onClick={() => shiftWeek(-1)}>
              <Icon name="chevronLeft" size={16} />
            </button>
            <button type="button" aria-label="下一周" onClick={() => shiftWeek(1)}>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
          <button type="button" className="sched-new" aria-label="新建日程" title="新建日程" onClick={() => openCompose(selectedDay)}>
            <Icon name="plus" size={15} />
          </button>
        </div>
      </header>

      <div className="sched-layout">
        <aside className="sched-side">
          <section className="sched-day-card" aria-label="今日待办">
            <header className="sched-day-head">
              <div>
                <strong>
                  {sameDay(selectedDay, today)
                    ? t("Today")
                    : `${selectedDay.getMonth() + 1}月${selectedDay.getDate()}日`}
                </strong>
                <small>
                  {WEEKDAYS[selectedDay.getDay()]}
                  {sameDay(selectedDay, today)
                    ? ` · ${selectedDay.getMonth() + 1}月${selectedDay.getDate()}日`
                    : ""}
                </small>
              </div>
              <button type="button" aria-label="新建日程" onClick={() => openCompose(selectedDay)}>
                <Icon name="plus" size={16} />
              </button>
            </header>
            <div className="sched-side-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "todo"}
                onClick={() => setSideTab("todo")}
              >
                待办清单
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "schedule"}
                onClick={() => setSideTab("schedule")}
              >
                日程
              </button>
            </div>
            <div className="sched-side-scroll">
              <div className="sched-side-group">
                <div className="sched-group-head">
                  <button
                    type="button"
                    className="sched-group-toggle"
                    aria-expanded={!collapsed[sideTab]}
                    onClick={() => toggleGroup(sideTab)}
                  >
                    <Icon name={collapsed[sideTab] ? "chevronRight" : "chevronDown"} size={12} />
                    <span>{sideTab === "todo" ? "本周" : "本月"}</span>
                  </button>
                  <button type="button" aria-label="在本周新建日程" onClick={() => openCompose(selectedDay)}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                {!collapsed[sideTab] && (sideRows.length ? (
                  sideRows.map((row) => (
                    <SideRow
                      key={row.key}
                      row={row}
                      done={isDone(row)}
                      busy={busyKey === row.key}
                      pinned={pinned.includes(row.key)}
                      onToggle={toggleDone}
                      onOpen={openRow}
                      onPin={togglePin}
                      onDelete={deleteRow}
                    />
                  ))
                ) : (
                  <p className="sched-side-empty">这一段时间没有安排</p>
                ))}
              </div>
              {sideTab === "todo" && (
                <div className="sched-side-group">
                  <div className="sched-group-head">
                    <button
                      type="button"
                      className="sched-group-toggle"
                      aria-expanded={!collapsed.later}
                      onClick={() => toggleGroup("later")}
                    >
                    <Icon name={collapsed.later ? "chevronRight" : "chevronDown"} size={12} />
                    <span>之后</span>
                  </button>
                  <button type="button" aria-label="新建日程" onClick={() => openCompose(selectedDay)}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                  {!collapsed.later && (nextRows.length ? (
                    nextRows.map((row) => (
                      <SideRow
                        key={row.key}
                        row={row}
                        done={isDone(row)}
                        busy={busyKey === row.key}
                        pinned={pinned.includes(row.key)}
                        onToggle={toggleDone}
                        onOpen={openRow}
                        onPin={togglePin}
                        onDelete={deleteRow}
                      />
                    ))
                  ) : (
                    <p className="sched-side-empty">没有更多待办</p>
                  ))}
                </div>
              )}
              <div className="sched-side-group">
                <div className="sched-group-head">
                  <button
                    type="button"
                    className="sched-group-toggle"
                    aria-expanded={!collapsed.unscheduled}
                    onClick={() => toggleGroup("unscheduled")}
                  >
                    <Icon name={collapsed.unscheduled ? "chevronRight" : "chevronDown"} size={12} />
                    <span>未安排</span>
                  </button>
                  <button type="button" aria-label="新建日程" onClick={() => openCompose(selectedDay)}>
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                {!collapsed.unscheduled && <p className="sched-side-empty">没有未安排的事项</p>}
              </div>
              <div className="sched-side-group sched-calendars" aria-label="我的日历">
                <div className="sched-group-head">
                  <span className="sched-group-title">我的日历</span>
                </div>
                <label className="sched-calendar-row">
                  <span className="sched-swatch reminder" />
                  <span>本地提醒</span>
                  <input
                    type="checkbox"
                    checked={visibleKinds.reminder}
                    onChange={() => setVisibleKinds((value) => ({ ...value, reminder: !value.reminder }))}
                  />
                </label>
                <label className="sched-calendar-row">
                  <span className="sched-swatch event" />
                  <span>本地日程</span>
                  <input
                    type="checkbox"
                    checked={visibleKinds.event}
                    onChange={() => setVisibleKinds((value) => ({ ...value, event: !value.event }))}
                  />
                </label>
              </div>
            </div>
          </section>
        </aside>

        <section
          className="sched-board"
          aria-label="周日程"
          ref={boardRef}
          style={{ "--day-count": dayCount }}
        >
          <div className="sched-head-clip" ref={headClipRef}>
            <div className="sched-head-inner" style={{ width: boardInnerW }}>
          <div className="sched-board-head">
            <span className="sched-timezone">
              GMT{-new Date().getTimezoneOffset() >= 0 ? "+" : "−"}
              {Math.floor(Math.abs(new Date().getTimezoneOffset()) / 60)}
            </span>
            {days.map((day) => {
              const isToday = sameDay(day, today);
              const isSelected = sameDay(day, selectedDay);
              return (
                <button
                  type="button"
                  key={dayKey(day)}
                  className={"sched-daybtn" + (isToday ? " is-today" : "") + (isSelected ? " is-selected" : "")}
                  onClick={() => setSelectedDay(atMidnight(day))}
                >
                  <span className="sched-daynum">{day.getDate()}</span>
                  <span className="sched-dayname">{WEEKDAYS_EN[day.getDay()]}</span>
                </button>
              );
            })}
          </div>
          <div className="sched-allday">
            <span className="sched-allday-label">全天</span>
            {days.map((day) => (
              <span key={dayKey(day)} className="sched-allday-cell" />
            ))}
          </div>
            </div>
          </div>
          <div
            className="sched-scroll"
            ref={(element) => {
              scrollRef.current = element;
            }}
            onScroll={(event) => {
              if (headClipRef.current) headClipRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }}
          >
            <div
              className="sched-grid"
              style={{ width: boardInnerW, height: GRID_HEIGHT + 24, "--sched-hour": `${HOUR_HEIGHT}px` }}
            >
              <div className="sched-gutter">
                {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
                  <span key={index} style={{ top: index * HOUR_HEIGHT }}>
                    {hourLabel(START_HOUR + index)}
                  </span>
                ))}
              </div>
              <div className="sched-cols">
                {days.map((day) => {
                  const items = layOutDay(weekRows, day);
                  const isToday = sameDay(day, today);
                  return (
                    <div
                      className={"sched-col" + (sameDay(day, today) ? " is-today" : "") + (sameDay(day, selectedDay) ? " is-selected" : "")}
                      key={dayKey(day)}
                      onClick={(event) => pickSlot(day, event)}
                    >
                      {isToday && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
                        <span className="sched-now" style={{ top: nowTop }} aria-hidden="true">
                          <i />
                        </span>
                      )}
                      {items.map((item) => {
                        const { symbol, text } = cardTitle(item.title);
                        return (
                          <button
                            type="button"
                            key={item.key}
                            className={"sched-event is-" + item.kind + (item.paused ? " is-paused" : "") + (item.height < 68 ? " is-compact" : "")}
                            style={{
                              top: item.top,
                              height: item.height,
                              left: 5,
                              width: "calc(100% - 10px)",
                            }}
                            onClick={(event) => openRow(item, event.currentTarget)}
                          >
                            <span className="sched-event-emoji">{symbol || (item.kind === "event" ? "📅" : "⏰")}</span>
                            <strong>{text}</strong>
                            <small>
                              {item.kind === "event"
                                ? `${hm12(item.at)} – ${hm12(item.until)} ${meridiem(item.until)}`
                                : `${hm12(item.at)} ${meridiem(item.at)}`}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {error && <p className="sched-error" role="alert">{error}</p>}
          {notice && <p className="sched-notice" role="status">{notice}</p>}
        </section>
      </div>

      {compose && (
        <div className="sched-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setCompose(null)}>
          <form className="sched-dialog" onSubmit={createReminder}>
            <header>
              <div>
                <small>本地日程</small>
                <strong>新建日程</strong>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setCompose(null)}>
                <Icon name="close" size={16} />
              </button>
            </header>
            <label className="sched-field">
              <span>标题</span>
              <input
                ref={titleInput}
                value={title}
                maxLength={512}
                placeholder="例如：和设计团队同步"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <DateCalendar
              value={when ? new Date(when) : null}
              onChange={(date) => {
                const time = when.split("T")[1] || "09:00";
                setWhen(date ? `${dayKey(date)}T${time}` : "");
              }}
              aside={
                <TimeField
                  ariaLabel="日程时间"
                  value={when ? Math.floor(new Date(when).getHours()) * 60 + new Date(when).getMinutes() : 540}
                  disabled={!when}
                  onChange={(minutes) => {
                    const datePart = when.split("T")[0];
                    if (!datePart) return;
                    setWhen(`${datePart}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
                  }}
                />
              }
            />
            <p className="sched-dialog-note">仅保存到这台设备，也会同步出现在活动面板的「即将发生」。</p>
            {formError && <p className="sched-dialog-error" role="alert">{formError}</p>}
            <footer>
              <button type="button" className="sched-ghost" onClick={() => setCompose(null)}>
                取消
              </button>
              <button type="submit" className="sched-save" disabled={saving || !title.trim()}>
                {saving ? "保存中…" : "保存日程"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {detail && (
        <div
          className="sched-row-menu"
          ref={menuRef}
          role="dialog"
          aria-label="日程详情"
          tabIndex={-1}
          style={menuPos ? { left: menuPos.left, top: menuPos.top } : { visibility: "hidden" }}
        >
          {(() => {
            const { symbol, text } = cardTitle(detail.row.title);
            const at = new Date(detail.row.at);
            const done = isDone(detail.row);
            return (
              <>
                <header>
                  <span className={"sched-swatch " + detail.row.kind} />
                  <small>{detail.row.kind === "reminder" ? "本地提醒" : "本地日程"}</small>
                  {(detail.row.paused || done) && <em>已完成</em>}
                </header>
                {symbol && <span className="sched-row-menu-emoji">{symbol}</span>}
                <strong className="sched-row-menu-title">{text}</strong>
                <p className="sched-row-menu-time">
                  {at.toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" })}
                  <span> · </span>
                  {detail.row.until
                    ? `${hm12(detail.row.at)} – ${hm12(detail.row.until)} ${meridiem(detail.row.until)}`
                    : `${hm12(detail.row.at)} ${meridiem(detail.row.at)}`}
                </p>
                <div className="sched-row-menu-actions">
                  <button
                    type="button"
                    className="sched-row-menu-action"
                    disabled={busyKey === detail.row.key}
                    onClick={() => toggleDone(detail.row)}
                  >
                    <span className={"sched-check-inline" + (done ? " is-done" : "")} aria-hidden="true">
                      {done && (
                        <svg viewBox="0 0 24 24" width={9} height={9} fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5.2 12.4 9.6 16.8 18.8 7" />
                        </svg>
                      )}
                    </span>
                    {done ? "标记为未完成" : "标记为完成"}
                  </button>
                  <button type="button" className="sched-row-menu-action" onClick={() => jumpToRow(detail.row)}>
                    <Icon name="calendar" size={13} />
                    在日历中定位
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </main>
  );
}
