import { useState } from "react";
import { t } from "../i18n";
import Icon from "./Icon";

// Sidebar per the hanoa studio case: a "General" group with the function
// entries (search lives in the top bar; settings sits at the bottom below
// the notification unit) and a "Recents" group listing the conversation
// history. Every glyph comes from the case icon sheet: home / keyhole-free
// check ring / bead ring / archive drawers / flower gear.
const GENERAL = [
  ["chat", "chat", "Chat"],
  ["calendar", "goals", "Calendar"],
  ["feed", "dots", "灵感"],
  ["library", "archive", "Library"],
];
const RECENTS_LIMIT = 8;
const PIN_KEY = "withu.pinnedConversations";

function readPinned() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PIN_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export default function Navigation({
  route,
  onNavigate,
  onSearch,
  recents = [],
  activeId,
  onSelectRecent,
  onDeleteRecent,
  footer,
  mode = "comfort",
}) {
  const [pinned, setPinned] = useState(readPinned);
  const isActive = (key) =>
    key === "library"
      ? route.startsWith("library")
      : key === "settings"
        ? route.startsWith("settings")
        : route === key;

  const togglePin = (id) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id];
      try {
        window.localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        /* private mode — pinning stays session-local */
      }
      return next;
    });
  };

  // Pinned conversations keep their pin order on top; the rest stay sorted by
  // last activity, exactly like the case's recents list.
  // Comfort 与 Cowork 不共用这份列表：侧边栏只列当前模式自己的会话，
  //  Comfort 下叫「最近对话」，Cowork 下叫「最近任务」。
  const byActivity = recents
    .filter((c) => (c.mode || "comfort") === mode)
    .slice()
    .sort((a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")));
  const recentItems = [
    ...pinned.map((id) => byActivity.find((c) => c.conversation_id === id)).filter(Boolean),
    ...byActivity.filter((c) => !pinned.includes(c.conversation_id)),
  ].slice(0, RECENTS_LIMIT);

  return (
    <nav className="nav-rail" aria-label={t("Main navigation")}>
      <div className="sidebar-group">
        <div className="sidebar-heading">{t("General")}</div>
        {GENERAL.map(([key, icon, label]) => (
          <button
            key={key}
            className={"sidebar-item" + (isActive(key) ? " active" : "")}
            aria-current={isActive(key) ? "page" : undefined}
            onClick={() => (key === "search" ? onSearch() : onNavigate(key))}
          >
            <Icon name={icon} size={22} weight={isActive(key) ? 0.7 : 0} />
            {/* 第一条入口跟着模式走：Comfort 里是聊天，Cowork 里是干活。 */}
            <span>{t(key === "chat" && mode === "cowork" ? "Work" : label)}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-group">
        <div className="sidebar-heading">{t(mode === "cowork" ? "最近任务" : "Recents")}</div>
        {recentItems.map((c) => {
          const isPinned = pinned.includes(c.conversation_id);
          return (
            <div
              key={c.conversation_id}
              className={
                "sidebar-recent" +
                (c.conversation_id === activeId ? " active" : "") +
                (isPinned ? " pinned" : "")
              }
            >
              <button
                className="sidebar-recent-main"
                aria-current={c.conversation_id === activeId ? "page" : undefined}
                onClick={() => onSelectRecent?.(c.conversation_id)}
              >
                <span>{c.title || t("New chat")}</span>
              </button>
              <span className="sidebar-recent-actions">
                <button
                  type="button"
                  className="recent-action"
                  aria-label={(isPinned ? t("取消置顶") : t("置顶会话")) + " " + (c.title || "")}
                  aria-pressed={isPinned}
                  onClick={() => togglePin(c.conversation_id)}
                >
                  <Icon name="pin" size={14} weight={isPinned ? 0.8 : 0} />
                </button>
                <button
                  type="button"
                  className="recent-action"
                  aria-label={t("删除会话") + " " + (c.title || "")}
                  onClick={() => onDeleteRecent?.(c)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </div>
          );
        })}
        {!recentItems.length && <div className="sidebar-empty">{t(mode === "cowork" ? "暂无任务" : "暂无对话")}</div>}
      </div>
      <div className="nav-bottom">
        {footer && <div className="nav-notifications">{footer}</div>}
        <div className="sidebar-group sidebar-bottom">
          <button
            className={"sidebar-item" + (isActive("settings") ? " active" : "")}
            aria-current={isActive("settings") ? "page" : undefined}
            onClick={() => onNavigate("settings/general")}
          >
            <Icon name="settings" size={22} weight={isActive("settings") ? 0.7 : 0} />
            <span>{t("Settings")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
