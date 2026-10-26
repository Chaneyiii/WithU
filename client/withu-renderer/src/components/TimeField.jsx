import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./time-field.css";

/**
 * 应用内时间选择。
 * 原生 <input type="time"> 在 Windows 上会弹系统时钟浮层（灰底、方角、字体也不一样），
 * 和这套玻璃皮肤完全割裂；这里自己画一列小时 + 一列分钟。
 *
 * value / onChange 都按「当天第几分钟」(0..1439) 走，和 policy.quiet_hours 的存法一致。
 */

const pad = (value) => String(value).padStart(2, "0");

function minuteOptions(value) {
  const base = [];
  for (let m = 0; m < 60; m += 5) base.push(m);
  if (!base.includes(value)) {
    base.push(value);
    base.sort((a, b) => a - b);
  }
  return base;
}

export default function TimeField({ value = 0, onChange, ariaLabel, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(null);
  const root = useRef(null);
  const hourCol = useRef(null);
  const minuteCol = useRef(null);

  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;

  const place = () => {
    const trigger = root.current?.querySelector(".withu-time-trigger");
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const width = 186;
    const height = 214;
    const left = Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8));
    const below = box.bottom + 6;
    setSpot({
      top: below + height > window.innerHeight - 8 ? Math.max(8, box.top - 6 - height) : below,
      left,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  // 打开时把当前值滚到中间，免得看到一片 00。
  useLayoutEffect(() => {
    if (!open) return;
    [hourCol.current, minuteCol.current].forEach((col) => {
      const active = col?.querySelector(".is-current");
      if (!active) return;
      col.scrollTop = active.offsetTop - col.clientHeight / 2 + active.offsetHeight / 2;
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      const inMenu = event.target?.closest?.(".withu-time-menu");
      if (!root.current?.contains(event.target) && !inMenu) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    // 只有滚轮落在浮层外面才收起来。以前用捕获阶段的 scroll 一刀切，
    // 结果滚轮一进菜单就把菜单卸掉——不仅没法选时间，正在滚动的节点
    // 被当场移除还会把渲染进程带崩（窗口再也点不开）。
    const wheel = (event) => {
      if (!event.target?.closest?.(".withu-time-menu")) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    document.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      document.removeEventListener("wheel", wheel);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [open]);

  const pick = (nextHour, nextMinute) => onChange?.(nextHour * 60 + nextMinute);

  return (
    <div className={"withu-time" + (open ? " is-open" : "")} ref={root}>
      <button
        type="button"
        className="withu-time-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M12 3.4a8.6 8.6 0 1 1 0 17.2 8.6 8.6 0 0 1 0-17.2ZM12 7.2v5.1l3.4 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="withu-time-value">
          {pad(hour)}
          <i>:</i>
          {pad(minute)}
        </span>
      </button>
      {open &&
        spot &&
        createPortal(
          <div
            className="withu-time-menu"
            role="dialog"
            aria-label={ariaLabel}
            style={{ top: spot.top, left: spot.left }}
          >
            <div className="withu-time-col" ref={hourCol} role="listbox" aria-label="小时">
              {Array.from({ length: 24 }, (_, h) => (
                <button
                  key={h}
                  type="button"
                  role="option"
                  aria-selected={h === hour}
                  className={h === hour ? "is-current" : ""}
                  onClick={() => pick(h, minute)}
                >
                  {pad(h)}
                </button>
              ))}
            </div>
            <div className="withu-time-col" ref={minuteCol} role="listbox" aria-label="分钟">
              {minuteOptions(minute).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={m === minute}
                  className={m === minute ? "is-current" : ""}
                  onClick={() => pick(hour, m)}
                >
                  {pad(m)}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
