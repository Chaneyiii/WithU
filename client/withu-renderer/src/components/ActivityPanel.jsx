import { Fragment, useEffect, useState } from "react";
import Icon, { IconButton } from "./Icon";
import { t } from "../i18n";
import EmotionalBall from "./EmotionalBall";
import IdentityCards from "./IdentityCards";
import LiveCallCard from "./LiveCallCard";
import { desktopBridge } from "../desktop-bridge";
import { PRESENCE_LABELS, PRESENCE_MOODS } from "../presence/presentation";

const tabs = [
  ["activity", "Activity", "activity"],
  ["approvals", "Approvals", "legal"],
  ["upcoming", "Upcoming", "k-upcoming"],
  ["identity", "Identity", "identity"],
];

const DAY = 86400000;
const hourMinute = (at) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function dayLabel(at, midnight) {
  const offset = Math.floor((at - midnight) / DAY);
  if (offset <= 0) return t("Today");
  if (offset === 1) return t("Tomorrow");
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

// The panel's "Upcoming" tab lists the real local schedule: reminders and
// calendar entries written by the life tools (or by a confirmed action). Only
// tomorrow-and-later plus anything from the last hour stays visible, so a
// finished morning event drops out on its own instead of trailing the list.
function upcomingRows(life, now) {
  if (!life) return [];
  const rows = [];
  for (const reminder of life.reminders || []) {
    if (reminder.status === "deleted") continue;
    rows.push({
      key: "reminder:" + reminder.id,
      kind: "reminder",
      at: Number(reminder.due_at) * 1000,
      title: reminder.text,
      paused: reminder.status === "paused",
    });
  }
  for (const event of life.calendar || []) {
    rows.push({
      key: "calendar:" + event.id,
      kind: "calendar",
      at: Number(event.starts_at) * 1000,
      until: Number(event.ends_at) * 1000,
      title: event.title,
    });
  }
  return rows
    .filter((row) => Number.isFinite(row.at) && row.at >= now - 3600000)
    .sort((a, b) => a.at - b.at)
    .slice(0, 40);
}

export default function ActivityPanel({
  livePresence = "idle",
  presencePreview,
  ballMood,
  onBallMood,
  ballPulse,
  onBallInteract,
  state,
  update,
  busy,
  onClose,
  onNavigate,
  onMessageFocus,
  onOpenIdentityFile,
  onOpenMemory,
  onOpenApp,
  onOpenSchedule,
  callOpen = false,
  chat,
  replyRun,
  liveTranscript = null,
  inputLevel = 0,
  micMuted = false,
  onMicMuted,
  ttsMuted = false,
  onToggleTts,
  onHangup,
}) {
  const [tab, setTab] = useState("activity");
  useEffect(() => {
    if (!callOpen) setTab("activity");
  }, [callOpen]);
  const [life, setLife] = useState(null);
  const [lifeBusy, setLifeBusy] = useState(false);
  const [lifeError, setLifeError] = useState("");
  const activities = state.activities || [];
  const now = Date.now();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const rows = upcomingRows(life, now);
  // 实时通话期间真实语音状态优先，开发预览只在非通话时驱动展示。
  const presence = callOpen ? livePresence : (presencePreview?.state || livePresence);
  const previewing = Boolean(presencePreview) && !callOpen;

  async function loadLife() {
    const bridge = desktopBridge();
    if (!bridge?.lifeList) {
      setLifeError(t("Local schedule unavailable"));
      return;
    }
    setLifeBusy(true);
    setLifeError("");
    try {
      setLife(await bridge.lifeList({ schema_version: 1, scope: "comfort" }));
    } catch (error) {
      setLifeError(error?.message || t("Local schedule unavailable"));
    } finally {
      setLifeBusy(false);
    }
  }

  useEffect(() => {
    void loadLife();
    // 聊天审批卡允许/取消后生活数据已变化，重拉让「即将发生」即时更新。
    const reload = () => void loadLife();
    window.addEventListener("withu:life:changed", reload);
    return () => window.removeEventListener("withu:life:changed", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside className={"activity-panel" + (callOpen ? " is-call" : "")} aria-label={t("Activity panel")}>
      {!callOpen && (
        <IconButton
          icon="close"
          label={t("Close activity panel")}
          className="activity-close"
          onClick={onClose}
        />
      )}
      <div className="activity-identity">
        <EmotionalBall
          presenceState={presence}
          presentationOnly={previewing}
          mood={
            previewing
              ? PRESENCE_MOODS[presencePreview.state]
              : livePresence !== "idle"
                ? PRESENCE_MOODS[livePresence]
                : ballMood
          }
          onMood={onBallMood}
          pulse={ballPulse}
          onInteract={onBallInteract}
        />
        <h2>{state.agentName || "Lumi"}</h2>
      </div>
      {callOpen ? (
        <LiveCallCard
          key={chat?.id}
          chat={chat}
          replyRun={replyRun}
          liveTranscript={liveTranscript}
          presence={presence}
          active={callOpen}
          inputLevel={inputLevel}
          micMuted={micMuted}
          onMicMuted={onMicMuted}
          ttsMuted={ttsMuted}
          onToggleTts={onToggleTts}
          onHangup={onHangup}
        />
      ) : (
        <>
      {presencePreview && (
        <div className="presence-activity-status" role="status">
          {t("开发预览")} · {t(PRESENCE_LABELS[presencePreview.state])}
          {presencePreview.muted && " · " + t("麦克风已静音")}
          {presencePreview.quiet && " · " + t("共同安静")}
        </div>
      )}
      <div className="activity-tabs" role="tablist">
            {tabs.map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-label={t(label)}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                <Icon name={icon} size={18} />
                <span>{t(label)}</span>
              </button>
            ))}
          </div>
          <div className="activity-scroll">
            {tab === "activity" && (
              <>
                <h3>{t("Activity")}</h3>
                {busy && (
                  <div className="activity-entry">
                    <Icon name="activity" size={18} />
                    <div>
                      {t("Working")}
                      <small>{t("Waiting for reply")}</small>
                    </div>
                  </div>
                )}
                {activities.length ? (
                  activities
                    .slice()
                    .reverse()
                    .map((item) => (
                      <button
                        className="activity-entry"
                        key={item.id}
                        onClick={() => (item.messageId ? onMessageFocus(item) : onNavigate(item.chatId))}
                      >
                        {item.kind === "call" ? (
                          <Icon name="video" size={18} />
                        ) : item.kind === "user" ? (
                          <Icon name="users" size={18} />
                        ) : item.kind === "assistant" ? (
                          <Icon name="window" size={18} />
                        ) : (
                          <Icon
                            name={
                              item.kind === "reply" ? "chat" : item.kind === "error" ? "help" : "activity"
                            }
                            size={18}
                          />
                        )}
                        <div>
                          <strong>{t(item.title)}</strong>
                          <p>{item.detail}</p>
                          <small>
                            {new Date(item.created).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </small>
                        </div>
                      </button>
                    ))
                ) : (
                  <div className="activity-empty">
                    <Icon name="activity" size={28} />
                    <p>{t("No activity yet")}</p>
                    <small>{t("Your local activity will appear here.")}</small>
                  </div>
                )}
              </>
            )}
            {tab === "approvals" && (
              <>
                <h3>{t("Approvals")}</h3>
                <div className="activity-empty">
                  <Icon name="legal" size={28} />
                  <p>{t("No pending approvals")}</p>
                  <small>{t("Host approvals require a connected integration.")}</small>
                </div>
              </>
            )}
            {tab === "upcoming" && (
              <>
                <div className="activity-section-head">
                  <h3>{t("Upcoming")}</h3>
                  <button
                    type="button"
                    className="activity-section-refresh"
                    aria-label={t("Refresh")}
                    title={t("Refresh")}
                    disabled={lifeBusy}
                    onClick={() => void loadLife()}
                  >
                    <Icon name="refresh" size={14} />
                  </button>
                </div>
                {lifeError ? (
                  <div className="activity-empty">
                    <Icon name="k-upcoming" size={26} />
                    <p>{t("Local schedule unavailable")}</p>
                    <small>{lifeError}</small>
                    <button className="secondary" onClick={() => void loadLife()}>
                      {t("Retry")}
                    </button>
                  </div>
                ) : rows.length ? (
                  <div className="activity-timeline">
                    {rows.map((row, index) => {
                      const label = dayLabel(row.at, midnight);
                      const showDay = index === 0 || label !== dayLabel(rows[index - 1].at, midnight);
                      return (
                        <Fragment key={row.key}>
                          {showDay && <div className="activity-day">{label}</div>}
                          <button
                            className="activity-entry activity-when"
                            onClick={() => (onOpenSchedule ? onOpenSchedule(row.at) : onNavigate(null, "feed"))}
                          >
                            <span className="activity-when-time">
                              <strong>{hourMinute(row.at)}</strong>
                            </span>
                            <div>
                              <strong>{row.title}</strong>
                              <small>
                                {row.kind === "reminder" ? t("Reminder") : t("Event")}
                                {row.paused
                                  ? " · " + t("Paused")
                                  : row.until
                                    ? ` · ${hourMinute(row.until)}`
                                    : ""}
                              </small>
                            </div>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                ) : (
                  <div className="activity-empty">
                    <Icon name="k-upcoming" size={26} />
                    <p>{t("Nothing upcoming")}</p>
                    <small>{t("Reminders and local events show up here.")}</small>
                  </div>
                )}
              </>
            )}
            {tab === "identity" && (
              <>
                <h3>{t("Identity")}</h3>
                <label className="field-label">
                  {t("Name")}
                  <input
                    value={state.agentName || "Lumi"}
                    onChange={(e) =>
                      update({
                        agentName: e.target.value,
                      })
                    }
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() =>
                    update({
                      agentName: "Lumi",
                    })
                  }
                >
                  {t("Reset name")}
                </button>
                <IdentityCards
                  state={state}
                  onOpen={(card) =>
                    card.key === "memory"
                      ? onOpenMemory?.()
                      : card.key === "app"
                        ? onOpenApp?.()
                        : onOpenIdentityFile?.(card)
                  }
                />
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
