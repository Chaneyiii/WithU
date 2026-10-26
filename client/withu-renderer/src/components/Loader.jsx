import "./Loader.css";

// 全局加载指示器：一支手写感的「＋」在缓慢自转，右边是可选的灰色文案，
// 文案上有一道暖白色的流光扫过。参考案例里最抓人的就是这两件事——
// 十字不匀速地转，字在呼吸，所以这里刻意没有做圆环 spinner。
export default function Loader({ label = "", size = 18, inline = false, className = "" }) {
  const classes = ["loader", inline ? "is-inline" : "", className].filter(Boolean).join(" ");
  return (
    <span className={classes} role="status" aria-live="polite">
      <span className="loader-spark" style={{ "--loader-size": `${size}px` }} aria-hidden="true">
        <i />
        <i />
      </span>
      {label ? <span className="loader-label">{label}</span> : null}
    </span>
  );
}
