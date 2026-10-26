import { desktopBridge } from "../desktop-bridge";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import Icon from "./Icon";

const MODES = [
  ["comfort", "WithU Comfort"],
  ["cowork", "WithU Cowork"],
];

// Top bar per the hanoa studio case: product logo + mode name with the
// up/down chevrons switcher, then two utility controls - a sidebar toggle
// pill and an undo/redo pill (the undo and redo arrows share one pill with
// a hairline divider). No slash and no conversation title.
// The switcher popup replicates the user-supplied video case (segmented pill
// with a caret) but opens BELOW the trigger as instructed.
export default function DesktopChrome({ mode, onMode, onToggleSidebar, onSearch, sidebarHidden }) {
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const root = useRef(null);
  // 自绘的最小化 / 最大化 / 关闭：窗口状态由主进程推过来，好切换图标。
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onWindowState) return undefined;
    return bridge.onWindowState((state) => setMaximized(Boolean(state?.maximized)));
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const pick = (value) => {
    setOpen(false);
    if (value !== mode) onMode?.(value);
  };
  // Undo/redo act on the focused editable (the composer textarea is focused
  // on demand) via the editing command API, matching the case's arrows.
  const editTarget = () => {
    const active = document.activeElement;
    if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && !["checkbox", "radio", "range", "file"].includes(active.type)))) return active;
    const composer = document.querySelector(".composer textarea, .composer input[type='text']");
    if (composer) composer.focus();
    return composer;
  };
  const undo = () => {
    const el = editTarget();
    if (el) document.execCommand("undo");
  };
  const redo = () => {
    const el = editTarget();
    if (el) document.execCommand("redo");
  };
  return (
    <header className="desktop-titlebar">
      <div className="topbar-brand" ref={root}>
        <button
          type="button"
          className="topbar-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("切换对话模式")}
          title={mode === "comfort" ? "chat here" : "work here"}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={mode} size={26} className="topbar-logo" />
          <strong>{mode === "comfort" ? "WithU Comfort" : "WithU Cowork"}</strong>
          <Icon name="chevrons" size={16} className={"topbar-chevrons" + (open ? " flip" : "")} />
        </button>
        {open && (
          <div className="mode-switcher-menu" role="menu" aria-label={t("切换对话模式")}>
            {MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === mode}
                className={value === mode ? "active" : ""}
                title={value === "comfort" ? "chat here" : "work here"}
                data-tooltip-in-menu=""
                onClick={() => pick(value)}
              >
                <Icon name={value} size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Two separate utility pills per the case image: [sidebar toggle,
          search] on the left and [undo | redo] with a hairline divider on
          the right. */}
      <div className="topbar-tools">
        <div className="topbar-tool-pill topbar-tool-pill-wide" role="group" aria-label={t("应用工具")}>
          <button
            type="button"
            className="topbar-tool-btn"
            aria-label={t("切换侧边栏")}
            aria-pressed={!sidebarHidden}
            onClick={() => onToggleSidebar?.()}
          >
            <Icon name="sidebar" size={16} />
          </button>
          <button
            type="button"
            className="topbar-tool-btn"
            aria-label={t("Search")}
            onClick={() => onSearch?.()}
          >
            <Icon name="search" size={16} />
          </button>
        </div>
        <div className="topbar-tool-pill" role="group" aria-label={t("撤销与恢复")}>
          <button type="button" className="topbar-tool-btn" aria-label={t("Undo")} onClick={undo}>
            <Icon name="back" size={16} />
          </button>
          <span className="tool-divider" aria-hidden="true" />
          <button type="button" className="topbar-tool-btn" aria-label={t("Redo")} onClick={redo}>
            <Icon name="forward" size={16} />
          </button>
        </div>
      </div>
      <div
        className="desktop-drag-space"
        onDoubleClick={() => desktopBridge()?.toggleMaximize()}
      />
      {/* 自绘的窗口控件：和整套玻璃皮肤一致，不再用 Windows 原生标题栏按钮。 */}
      <div className="window-controls" role="group" aria-label={t("窗口控制")}>
        <button
          type="button"
          className="window-btn"
          aria-label={t("最小化")}
          title={t("最小化")}
          onClick={() => desktopBridge()?.minimize()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="window-btn"
          aria-label={maximized ? t("还原") : t("最大化")}
          title={maximized ? t("还原") : t("最大化")}
          onClick={() => desktopBridge()?.toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5.5" y="8" width="10.5" height="10.5" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8.5 8V6.7A2.2 2.2 0 0 1 10.7 4.5h6.6A2.2 2.2 0 0 1 19.5 6.7v6.6a2.2 2.2 0 0 1-2.2 2.2h-1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5.5" y="5.5" width="13" height="13" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="window-btn is-close"
          aria-label={t("关闭")}
          title={t("关闭")}
          onClick={() => desktopBridge()?.close()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
