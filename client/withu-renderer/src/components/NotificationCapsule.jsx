import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import "./notification-capsule.css";

const TRANSIENT_TTL = 5500;
const LIP_COUNT = 2;

function relativeTime(created) {
  if (!created) return "";
  const minutes = Math.floor((Date.now() - created) / 60000);
  if (minutes < 1) return t("刚刚");
  if (minutes < 60) return minutes + " " + t("分钟前");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " " + t("小时前");
  return Math.floor(hours / 24) + " " + t("天前");
}

// 通知单元，按用户给的案例视频做：一叠卡片，最新的那张完整展开——加粗标题、
// 右上角 ×、两行正文、底部一条通栏深色按钮；更旧的卡只在顶上露出两条边。
// 滚轮在叠上滚动就翻到下一张（先弹走再顶上来），点 × 关掉正面那张，
// 铃铛把整叠收起/放出，垃圾桶一条清空。
export default function NotificationCapsule({ notices = [], feed = [], onDismiss, onAction }) {
  const [dismissed, setDismissed] = useState(() => new Set());
  const [hidden, setHidden] = useState(false);
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const wheelAcc = useRef(0);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const items = useMemo(() => {
    const transient = notices.map((notice) => ({
      id: notice.id,
      title: notice.title,
      body: notice.body || "",
      meta: "",
      created: notice.created || Date.now(),
      ttl: notice.ttl != null ? notice.ttl : TRANSIENT_TTL,
      kind: "transient",
      route: notice.route || "",
      // T14 记忆候选：透传给 onAction，由 App 走显式 memory:save；
      // 没有它 CTA 只会关闭通知，保存路径永远不触发。
      memoryCandidate: notice.memoryCandidate || null,
    }));
    const undelivered = feed
      .filter((item) => item.notification_status !== "shown_by_os")
      .map((item) => ({
        id: "feed:" + item.candidate_id,
        title: item.title,
        body: item.body || "",
        meta: item.source || "",
        created: Number(item.created_at) || 0,
        kind: "feed",
        route: "feed",
      }));
    return [...transient, ...undelivered]
      .filter((item) => !dismissed.has(item.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0));
  }, [notices, feed, dismissed]);

  const dismiss = useCallback((id) => {
    setDismissed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    onDismissRef.current?.(id);
  }, []);

  // Sweep expired transient notices; feed candidates persist until dismissed.
  useEffect(() => {
    if (!items.some((item) => item.kind === "transient")) return;
    const timer = setInterval(() => {
      const now = Date.now();
      for (const item of items) {
        if (item.kind === "transient" && item.ttl && now - item.created >= item.ttl) dismiss(item.id);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [items, dismiss]);

  useEffect(() => {
    if (offset >= items.length) setOffset(0);
  }, [items.length, offset]);

  // 翻卡：先让正面卡弹走，再换下一张顶上来，节奏对齐案例视频。
  // steps 支持一次翻过多张——点露出的卡片边时直接翻到那一张。
  const advance = useCallback(
    (dir, steps = 1) => {
      if (items.length < 2 || leaving) return;
      setLeaving(true);
      window.setTimeout(() => {
        setOffset((value) => (value + dir * steps + items.length * steps) % items.length);
        setLeaving(false);
      }, 150);
    },
    [items.length, leaving],
  );

  const onWheel = (event) => {
    event.preventDefault();
    wheelAcc.current += event.deltaY;
    if (Math.abs(wheelAcc.current) >= 40) {
      advance(wheelAcc.current > 0 ? 1 : -1);
      wheelAcc.current = 0;
    }
  };

  const ordered = items.map((_, i) => items[(i + offset) % items.length]);
  const front = ordered[0];

  return (
    <div className="notification-capsule">
      {!hidden && front && (
        <div className="capsule-stack" onWheel={onWheel}>
          {ordered.slice(1, 1 + LIP_COUNT).map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="capsule-lip"
              style={{ "--lip": i + 1 }}
              aria-label={t("切换到") + " " + item.title}
              title={item.title}
              onClick={() => advance(1, i + 1)}
            />
          ))}
          <article key={front.id} className={"capsule-card" + (leaving ? " is-leaving" : "")}>
            <div className="capsule-card-top">
              <strong>{front.title}</strong>
              <button
                type="button"
                className="capsule-close"
                aria-label={t("关闭")}
                onClick={() => dismiss(front.id)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="capsule-card-body">
              {[relativeTime(front.created), front.body || front.meta].filter(Boolean).join(" · ")}
            </p>
            <button
              type="button"
              className="capsule-cta"
              onClick={() => {
                // 候选保存由 App 的 onAction 处理：成功才移除通知，失败保留可重试；
                // 关闭（✕）即拒绝、零痕迹，不经 CTA。
                if (front.route || front.memoryCandidate) onActionRef.current?.(front);
                if (!front.memoryCandidate) dismiss(front.id);
              }}
            >
              {front.memoryCandidate ? t("记住") : front.route ? t("查看") : t("知道了")}
            </button>
          </article>
        </div>
      )}
      <div className="capsule-foot">
        <button
          type="button"
          className="capsule-bell"
          aria-label={items.length ? `${t("Notifications")} (${items.length})` : t("Notifications")}
          title={t("Notifications")}
          onClick={() => setHidden((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 4.2a5.4 5.4 0 0 1 5.4 5.4c0 3.1.7 4.6 1.6 5.8.3.4 0 1-.5 1H5.5c-.5 0-.8-.6-.5-1 .9-1.2 1.6-2.7 1.6-5.8A5.4 5.4 0 0 1 12 4.2ZM10 18.6a2 2 0 0 0 4 0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {items.length > 0 && <span className="capsule-bell-count">{items.length}</span>}
        </button>
      </div>
    </div>
  );
}
