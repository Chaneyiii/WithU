import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import Icon from "./Icon";

// Breadcrumb pinned to the top-left of the main stage, replicating the case
// image ("Settings / Workspace / General"): it shows where the user is -
// the page name, plus the active sub-tab for the nested settings/library
// routes. Parent crumbs are muted, the current one is dark with an icon.
const SETTINGS_TABS = {
  general: ["General", "k-settings"],
  proactivity: ["Proactivity", "k-activity-sparkles"],
  connectors: ["Connectors", "k-connectors"],
  permissions: ["Permissions", "k-permissions"],
  devices: ["Devices", "k-devices"],
  "data-privacy": ["Data controls", "k-data"],
  "help-support": ["Help & support", "k-help"],
};
const LIBRARY_VIEWS = {
  artifacts: ["All artifacts", "k-artifacts"],
  documents: ["Documents", "k-docs"],
  web: ["Web artifacts", "k-web"],
  images: ["Images", "k-images"],
  videos: ["Videos", "k-videos"],
  podcasts: ["Podcasts", "k-podcasts"],
  files: ["System files", "k-files"],
};

function crumbsFor(route) {
  if (route.startsWith("settings")) {
    const tab = route.split("/")[1] || "general";
    const [label, icon] = SETTINGS_TABS[tab] || SETTINGS_TABS.general;
    return [["Settings", "k-settings"], [label, icon]];
  }
  if (route.startsWith("library")) {
    const view = route.split("/")[1] || "artifacts";
    const [label, icon] = LIBRARY_VIEWS[view] || LIBRARY_VIEWS.artifacts;
    return [["Library", "k-artifacts"], [label, icon]];
  }
  if (route === "feed") return [["灵感", "ideas"]];
  if (route === "calendar") return [["Calendar", "goals"]];
  if (route === "goals") return [["Goals", "goals"]];
  if (route === "ideas") return [["Ideas", "ideas"]];
  return [["Chat", "chat"]];
}

function relativeTime(created) {
  if (!created) return "";
  const minutes = Math.floor((Date.now() - created) / 60000);
  if (minutes < 1) return t("刚刚");
  if (minutes < 60) return minutes + " " + t("分钟前");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " " + t("小时前");
  return Math.floor(hours / 24) + " " + t("天前");
}

// 鼠标悬停在气泡图标上时弹出的会话信息卡：名字、路径、最近活动。
function sessionTooltip(session) {
  const title = session?.title || t("New chat");
  const shortId = String(session?.id || "").slice(0, 12);
  return JSON.stringify({
    title,
    path: `${session?.mode === "cowork" ? "cowork" : "comfort"} / ${shortId}`,
    activity: relativeTime(session?.lastActivityAt),
    meta: session?.messageCount ? `${session.messageCount} ${t("条消息")}` : "",
  });
}

export default function StageBreadcrumb({ route, session = null, onRename }) {
  const crumbs = crumbsFor(route);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session?.title || "");
  const committed = useRef(false);
  const inputRef = useRef(null);
  const isChat = route === "chat" && session;

  // 换一条会话或离开对话页就退出重命名，输入框不会粘在屏幕上。
  useEffect(() => {
    setRenaming(false);
  }, [session?.id, route]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const start = () => {
    setDraft(session?.title || "");
    setRenaming(true);
  };
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    setRenaming(false);
    const value = draft.trim();
    if (value && value !== session?.title) onRename?.(value);
  };

  return (
    <nav className="stage-breadcrumb" aria-label={t("当前位置")}>
      {isChat ? (
        <span className="stage-crumb current stage-session">
          <Icon name="chat" size={15} data-session-tooltip={sessionTooltip(session)} />
          {renaming ? (
            <input
              ref={inputRef}
              className="stage-session-input"
              aria-label={t("Rename chat")}
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                } else if (event.key === "Escape") {
                  committed.current = true;
                  setRenaming(false);
                }
              }}
              onBlur={commit}
            />
          ) : (
            <span
              className="stage-session-name"
              role="button"
              tabIndex={0}
              aria-label={t("重命名此对话")}
              data-tooltip={t("重命名此对话")}
              onDoubleClick={start}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  start();
                }
              }}
            >
              {session?.title || t("New chat")}
            </span>
          )}
        </span>
      ) : (
        crumbs.map(([label, icon], index) => (
          <span
            key={label + index}
            className={"stage-crumb" + (index === crumbs.length - 1 ? " current" : "")}
          >
            {index > 0 && (
              <span className="stage-crumb-sep" aria-hidden="true">
                /
              </span>
            )}
            {index === crumbs.length - 1 && <Icon name={icon} size={15} />}
            <span>{t(label)}</span>
          </span>
        ))
      )}
    </nav>
  );
}
