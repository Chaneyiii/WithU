import { useMemo, useState } from "react";
import "./date-picker.css";

const pad = (value) => String(value).padStart(2, "0");
const DAY = 86400000;

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const atMidnight = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const dayKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sameDay = (a, b) => a && b && dayKey(a) === dayKey(b);

// 预设和主题色一一对应，和案例一致：手动选是蓝，命中哪个预设整块就换哪个色。
const PRESETS = [
  { key: "today", label: "今天", tone: "blue" },
  { key: "tomorrow", label: "明天", tone: "green" },
  { key: "weekend", label: "周末", tone: "orange" },
  { key: "next-monday", label: "下周一", tone: "purple" },
];

function presetTarget(key, today) {
  const base = atMidnight(today);
  if (key === "today") return base;
  if (key === "tomorrow") return new Date(base.getTime() + DAY);
  if (key === "weekend") {
    // 最近的一个周六；今天正好是周末就选今天。
    const offset = (6 - base.getDay() + 7) % 7;
    return new Date(base.getTime() + offset * DAY);
  }
  if (key === "next-monday") {
    const offset = ((8 - base.getDay()) % 7) || 7;
    return new Date(base.getTime() + offset * DAY);
  }
  return null;
}

function matchedPreset(value, today) {
  if (!value) return null;
  return PRESETS.find((preset) => sameDay(presetTarget(preset.key, today), value)) || null;
}

function badgeLabel(value, today) {
  if (!value) return "未选择";
  const diff = Math.round((atMidnight(value) - atMidnight(today)) / DAY);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "后天";
  return `${diff} 天后`;
}

const BIG_MONTH = new Intl.DateTimeFormat("zh-CN", { month: "long" });

/**
 * 日程弹窗里内嵌的日期日历，按用户给的案例视频做：
 * 浅灰圆角卡（标题 + 右上角色块徽章），白色月历卡——顶部大字当前值 +
 * 彩色下划线（第二栏放时间选择），月份标题（月份粗体、年份灰），
 * 周一起始的星期行，今天有小圆点、过去的日期变灰不可点、选中日实心圆；
 * 底部一排预设胶囊（今天/明天/周末/下周一）+ 右侧清除，
 * 主题色跟着命中的预设换（手动选=蓝，今天=蓝，明天=绿，周末=橙，下周一=紫）。
 * aside：可选的第二栏内容（日程弹窗里放时间选择）。
 */
export default function DateCalendar({ value = null, onChange, aside = null }) {
  const [hover, setHover] = useState(null);

  const today = useMemo(() => atMidnight(new Date()), []);
  const selected = value ? atMidnight(new Date(value)) : null;
  const preset = matchedPreset(selected, today);
  const tone = preset ? preset.tone : "blue";

  const monthAnchor = selected || today;
  const grid = useMemo(() => {
    const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // 周一开头
    const days = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let day = 1; day <= days; day += 1) {
      cells.push(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day));
    }
    return cells;
  }, [monthAnchor.getFullYear(), monthAnchor.getMonth()]);

  const pick = (date) => {
    onChange?.(date);
    setHover(null);
  };

  const label = selected ? `${BIG_MONTH.format(selected)}${selected.getDate()}日` : "";

  return (
    <div className={`sched-date-panel tone-${tone}`}>
      <header className="sched-date-head">
        <strong>选择日期</strong>
        <span className="sched-date-badge">{badgeLabel(selected, today)}</span>
      </header>
      <div className="sched-date-card">
        <div className="sched-date-current-row">
          <div className="sched-date-current">
            <small>日期</small>
            <strong className={selected ? "" : "is-empty"}>{label || "选择日期"}</strong>
          </div>
          {aside && (
            <div className="sched-date-current sched-date-aside">
              <small>时间</small>
              <div className="sched-date-aside-body">{aside}</div>
            </div>
          )}
        </div>
        <div className="sched-date-month">
          <strong>{BIG_MONTH.format(monthAnchor)}</strong>
          <span>{monthAnchor.getFullYear()}</span>
        </div>
        <div className="sched-date-week" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="sched-date-grid">
          {grid.map((date, index) => {
            if (!date) return <span key={`blank-${index}`} />;
            const past = date.getTime() < today.getTime();
            const outside = date.getMonth() !== monthAnchor.getMonth();
            return (
              <button
                key={dayKey(date)}
                type="button"
                disabled={past}
                className={
                  "sched-date-day" +
                  (sameDay(date, selected) ? " is-selected" : "") +
                  (sameDay(date, hover) && !sameDay(date, selected) ? " is-hover" : "") +
                  (sameDay(date, today) ? " is-today" : "") +
                  (outside ? " is-out" : "") +
                  (past ? " is-past" : "")
                }
                onMouseEnter={() => setHover(date)}
                onMouseLeave={() => setHover((current) => (sameDay(current, date) ? null : current))}
                onClick={() => pick(date)}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
      <footer className="sched-date-presets">
        {PRESETS.map((item) => {
          const target = presetTarget(item.key, today);
          const active = sameDay(target, selected);
          return (
            <button
              key={item.key}
              type="button"
              className={"sched-date-chip tone-" + item.tone + (active ? " is-active" : "")}
              onClick={() => pick(target)}
            >
              {item.label}
            </button>
          );
        })}
        <button type="button" className="sched-date-clear" onClick={() => pick(null)}>
          清除
        </button>
      </footer>
    </div>
  );
}
