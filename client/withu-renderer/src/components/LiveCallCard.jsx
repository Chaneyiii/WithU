import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon";
import LiveWave from "./LiveWave";
import { t } from "../i18n";

// The square call sheet from the reference case, proportionally scaled into the
// fixed-width activity panel. The card is designed once at 560px and scaled as
// a whole, so type and the ribbon keep their original ratios.
// Every number below is measured off the reference frames: the card there is
// 202px wide, so 1 reference px = 560 / 202 = 2.77 design px (radius 8.5 → 24,
// status 9 → 25, control pill 31×23 → 86×64, gaps 17 → 47).
const CARD = 560;

export default function LiveCallCard({
  chat,
  replyRun,
  liveTranscript = null,
  presence = "idle",
  active = true,
  inputLevel = 0,
  micMuted = false,
  onMicMuted = () => {},
  ttsMuted = false,
  onToggleTts = () => {},
  onHangup = () => {},
}) {
  const wrap = useRef(null);
  const host = useRef(null);
  const chatList = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [callView, setCallView] = useState("voice");
  // 通话里的对话记录：只收本次通话的转录流，聊天窗口里原有的消息一条都不带。
  const [log, setLog] = useState([]);
  const segment = useRef(null);
  const scale = box.w > 0 ? box.w / CARD : 0.56;
  // 卡片不再是一个独立圆角块：它铺满活动面板，所以设计高度按面板实际高度换算，
  // 语音波形、转录都跟着面板变高，不会悬在中间留一条白。
  const designHeight = box.h > 0 ? Math.max(360, Math.round(box.h / scale)) : CARD;

  // 转录事件是一条一条推过来的（用户一句、助手一句），同一句会连续刷新多次。
  // 这里按 item_id / response_id 归并成气泡：同 id 覆盖文本，新 id 追加一条。
  useEffect(() => {
    if (!liveTranscript) {
      segment.current = null;
      return;
    }
    const key =
      liveTranscript.itemId ||
      liveTranscript.responseId ||
      `${liveTranscript.role || "assistant"}-${liveTranscript.generation || 0}`;
    const text = String(liveTranscript.text || "").trim();
    if (!text) return;
    if (segment.current === key) {
      setLog((list) => list.map((item) => (item.key === key ? { ...item, text } : item)));
      return;
    }
    segment.current = key;
    setLog((list) => [...list, { key, role: liveTranscript.role === "user" ? "user" : "assistant", text }]);
  }, [liveTranscript]);

  // 聊天视图默认贴底，新气泡进来时保持最新一条可见（和参考里的滚动行为一致）。
  useEffect(() => {
    if (callView !== "chat") return;
    const node = chatList.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [callView, log.length, replyRun?.state]);

  useLayoutEffect(() => {
    const node = wrap.current;
    if (!node) return;
    const measure = () => setBox({ w: node.clientWidth, h: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 底部四个按键要和聊天输入框保持一条水平线：量出输入框底边到窗口底边的距离，
  // 作为卡片底部留白，四个键的底边因此始终与输入框底边齐平。
  useEffect(() => {
    const node = host.current;
    const composer = document.querySelector(".composer") || document.querySelector(".composer-region");
    if (!node || !composer) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const gap = Math.max(0, Math.round(window.innerHeight - composer.getBoundingClientRect().bottom));
      node.style.setProperty("--call-bottom-gap", `${gap}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    const observer = new ResizeObserver(schedule);
    observer.observe(composer);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      node.style.removeProperty("--call-bottom-gap");
    };
  }, []);

  const status =
    presence === "speaking"
      ? t("Speaking")
      : presence === "thinking"
        ? t("Thinking")
        : presence === "degraded" || presence === "reconnecting"
          ? t("Reconnecting")
          : presence === "connecting"
            ? t("Connecting")
            : t("Listening");
  const transcript = liveTranscript?.text || "";
  const split = transcript
    ? Math.max(0, transcript.length - Math.min(48, Math.ceil(transcript.length * 0.32)))
    : 0;
  const chatting = callView === "chat";

  return (
    <div className="activity-call" ref={host}>
      <div className="call-stage" ref={wrap}>
        <div className="call-scale" style={{ transform: `scale(${scale})`, height: `${designHeight}px` }}>
          <div className="call-case-card">
            <header className="call-case-head">
              <div
                className={
                  "call-case-status" +
                  (presence === "speaking" && !chatting ? " is-speaking" : "") +
                  (micMuted ? " is-muted" : "")
                }
              >
                {chatting ? (
                  <span className="call-status-spark" aria-hidden="true" />
                ) : (
                  <span className="call-status-bars" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                )}
                <strong>{chatting ? t("Chat") : status}</strong>
              </div>
              <button className="call-case-close" onClick={onHangup}>
                {t("Close")}
              </button>
            </header>
            <div className="call-case-body">
              <div className={"call-case-atmo" + (chatting ? " is-faint" : "")}>
                <LiveWave
                  level={inputLevel}
                  speaking={presence === "speaking"}
                  muted={micMuted}
                  active={active}
                />
              </div>
              {chatting ? (
                <div className={"call-case-chat" + (log.length ? "" : " is-empty")} ref={chatList}>
                  {log.map((item) => (
                    <p
                      key={item.key}
                      className={"call-bubble " + (item.role === "user" ? "is-user" : "is-assistant")}
                    >
                      {item.text}
                    </p>
                  ))}
                  {replyRun?.state === "running" && (
                    <span className="call-typing" role="status" aria-label={t("Thinking")}>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  {!log.length && replyRun?.state !== "running" && (
                    <p className="call-chat-empty">{t("还没有对话，说句话就会出现在这里。")}</p>
                  )}
                </div>
              ) : (
                <div className="call-case-voice">
                  <p className="call-case-transcript">
                    {transcript ? (
                      <>
                        {transcript.slice(0, split)}
                        <span className="call-transcript-tail">{transcript.slice(split)}</span>
                      </>
                    ) : (
                      <span className="call-transcript-placeholder">{t("Listening")}…</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 和活动面板「活动 / 审批 / 即将发生 / 身份」同一套分段框。 */}
      <div className="call-tabs" role="tablist" aria-label="通话操作">
        <button
          type="button"
          role="tab"
          aria-selected={chatting}
          className="call-tab"
          onClick={() => setCallView((view) => (view === "chat" ? "voice" : "chat"))}
        >
          <Icon name="chat" size={15} />
          <span>消息</span>
        </button>
        <button
          type="button"
          className="call-tab"
          aria-pressed={micMuted}
          aria-label={micMuted ? "取消静音" : "静音麦克风"}
          onClick={() => onMicMuted(!micMuted)}
        >
          <Icon name={micMuted ? "micOff" : "mic"} size={15} />
          <span>{micMuted ? "已静音" : "麦克风"}</span>
        </button>
        <button
          type="button"
          className="call-tab"
          aria-pressed={ttsMuted}
          aria-label={ttsMuted ? "打开扬声器" : "关闭扬声器"}
          onClick={() => onToggleTts()}
        >
          <Icon name={ttsMuted ? "speakerMuted" : "speaker"} size={15} />
          <span>{ttsMuted ? "已关闭" : "扬声器"}</span>
        </button>
        <button
          type="button"
          className="call-tab call-tab-hangup"
          aria-label={t("结束 Withu-Live")}
          onClick={onHangup}
        >
          <Icon name="phone" size={15} className="call-hangup-icon" />
          <span>挂断</span>
        </button>
      </div>
    </div>
  );
}
