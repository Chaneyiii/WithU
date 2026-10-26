import { useState } from "react";
import { t } from "../i18n";
import Icon, { IconButton } from "./Icon";
import FeedCalendar from "./FeedCalendar";
import "./Feed.css";
// Merged page per the sidebar entry: dynamic updates (feed) plus ideas in one
// place, next to the local calendar card. The proactivity settings live in
// Settings; notifications are unrelated to this page.
const NOTIFICATION_STATUS = {
  pending: "Notification pending",
  shown_by_os: "OS confirmed notification shown",
  failed: "Notification failed",
  not_supported: "Notifications unavailable",
  unconfirmed: "Notification delivery unconfirmed",
};

// Feed timestamps arrive as unix seconds; the demo notification rows hand over
// milliseconds, so accept both instead of printing a 1970 date.
const stamp = (value) => {
  const number = Number(value) || 0;
  return number > 1e12 ? number : number * 1000;
};
const timeLabel = (ms) =>
  ms ? new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export function Feed({ items = [], ideas = [], onCreateIdea, onEditIdea, onRemoveIdea, focusDate, onNotice, onOpenItem }) {
  const entries = [
    ...items.map(item => ({ kind: "update", key: "u" + item.candidate_id, at: stamp(item.created_at), item })),
    ...ideas.map(item => ({ kind: "idea", key: "i" + item.id, at: 0, item })),
  ].sort((a, b) => b.at - a.at);
  return (
    <main className="standard-page feed-page">
      <header className="route-header">
        <h1>{t("Calendar")}</h1>
        <div className="header-actions">
          <button className="pill feed-new-idea" onClick={onCreateIdea}>
            <Icon name="plus" size={14} />
            {t("New idea")}
          </button>
        </div>
      </header>
      <div className="feed-content feed-layout">
        <FeedCalendar focusDate={focusDate} onNotice={onNotice} />
        <section className="feed-stream" aria-label={t("Updates and ideas")}>
          {entries.length ? (
            entries.map(entry => entry.kind === "update" ? (
              <article className="feed-card" key={entry.key}>
                <header className="feed-card-head">
                  <span className="feed-item-icon"><Icon name="k-activity-sparkles" size={18} /></span>
                  <div className="feed-card-title">
                    <h2>{entry.item.title}</h2>
                    <small>{timeLabel(entry.at)}</small>
                  </div>
                </header>
                <p className="feed-card-body">{entry.item.body}</p>
                <footer className="feed-card-foot">
                  <span className="feed-card-source">{entry.item.source}</span>
                  <span className={"feed-card-status is-" + (entry.item.notification_status || "unconfirmed")}>
                    {t(NOTIFICATION_STATUS[entry.item.notification_status] || NOTIFICATION_STATUS.unconfirmed)}
                  </span>
                  {onOpenItem && (
                    <button className="feed-card-link" onClick={() => onOpenItem(entry.item)}>
                      {t("View details")}
                      <Icon name="chevronRight" size={13} />
                    </button>
                  )}
                </footer>
              </article>
            ) : (
              <article className="feed-card feed-card-idea" key={entry.key}>
                <header className="feed-card-head">
                  <span className="feed-item-icon"><Icon name="dots" size={18} /></span>
                  <div className="feed-card-title">
                    <h2>{entry.item.title}</h2>
                    <small>{t("Idea")}</small>
                  </div>
                  <IconButton
                    icon="close"
                    label={t("Delete") + " " + entry.item.title}
                    onClick={() => onRemoveIdea(entry.item)}
                    size={28}
                  />
                </header>
                <button className="feed-card-body feed-entry-open" onClick={() => onEditIdea(entry.item)}>
                  {entry.item.description}
                </button>
              </article>
            ))
          ) : (
            <div className="feed-empty-state">
              <span className="feed-empty-icon"><Icon name="dots" size={24} /></span>
              <h3>{t("No activity yet")}</h3>
              <p>{t("Updates, greetings and new ideas show up here.")}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export function Ideas({ items = [], onCreate, onEdit, onRemove }) {
  return <main className="standard-page"><header className="route-header"><h1>{t("Ideas")}</h1><div className="header-actions"><IconButton icon="plus" label={t("New idea")} onClick={onCreate}/></div></header>
    {items.length ? items.map(item => <div className="goal-row" key={item.id}><button className="goal-title" onClick={() => onEdit(item)}>{item.title}<small>{item.description}</small></button><IconButton icon="close" label={t("Delete") + ' ' + item.title} onClick={() => onRemove(item)} size={28}/></div>) : <div className="idea-empty"><h2>{t("No ideas yet.")}</h2><p>{t("New ideas show up here as Withu learns about you.")}</p></div>}
  </main>;
}
export function Goals({ goals, onCreate, onToggle, onEdit, onRemove }) {
  const [completed, setCompleted] = useState(false);
  return (
    <main className="standard-page">
      <header className="route-header">
        <h1>{t("Goals")}</h1>
        <div className="header-actions">
          <IconButton icon="plus" label={t("New goal")} onClick={onCreate} />
          <button className="pill" onClick={() => setCompleted(!completed)}>
            {completed ? t("Active") : t("Completed")}
          </button>
        </div>
      </header>
      {goals.filter((g) => !!g.done === completed).length ? (
        goals
          .filter((g) => !!g.done === completed)
          .map((g) => (
            <div className="goal-row" key={g.id}>
              <button
                className={"goal-check " + (g.done ? "checked" : "")}
                aria-label={g.done ? t("Mark active") : t("Complete goal")}
                onClick={() => onToggle(g)}
              >
                <Icon name={g.done ? "check" : "goals"} size={20} />
              </button>
              <button className="goal-title" onClick={() => onEdit(g)}>
                {g.title}
                <small>{g.description}</small>
              </button>
              <IconButton
                icon="close"
                label={"Delete " + g.title}
                onClick={() => onRemove(g)}
                size={28}
              />
            </div>
          ))
      ) : (
        <div className="source-null-state">
          <Icon name="goals" size={28} />
          <h2>{completed ? t("No completed goals") : t("No goals yet")}</h2>
          <button className="primary" onClick={onCreate}>
            {t("New goal")}
          </button>
        </div>
      )}
    </main>
  );
}
