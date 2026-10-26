import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
// Tooltips flip below their target whenever there is not enough room above:
// the window title bar (54px, with the OS-drawn caption buttons occupying the
// top-right corner) covers anything that pops above it, so targets near the
// top always open downward. A post-render pass then keeps the box inside the
// viewport no matter where the target sits.
const TITLEBAR = 54;
export default function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const tipRef = useRef(null);
  useEffect(() => {
    let timer,
      target,
      lastClosed = 0;
    const convert = () =>
      document.querySelectorAll("[title]").forEach((el) => {
        if (el.tagName === "IFRAME") return;
        if (el.getAttribute("title"))
          el.dataset.tooltip = el.getAttribute("title");
        el.removeAttribute("title");
      });
    convert();
    const observer = new MutationObserver(convert);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    const hide = () => {
      clearTimeout(timer);
      target?.removeAttribute("aria-describedby");
      target = null;
      setTip(null);
      lastClosed = Date.now();
    };
    const enter = (e) => {
      const el = e.target.closest?.("[data-model-tooltip],[data-tooltip],[data-session-tooltip],button[aria-label]");
      if (
        !el ||
        el === target ||
        (document.querySelector('[role="dialog"]') && !el.closest('[role="dialog"]')) ||
        // 菜单项默认不弹说明，但标了 data-tooltip-in-menu 的（模式切换里的
        // chat here / work here）要在行尾给一句。
        (el.closest('[role="menu"]') && !el.hasAttribute("data-tooltip-in-menu")) ||
        el.getAttribute("aria-expanded") === "true"
      )
        return;
      clearTimeout(timer);
      target?.removeAttribute("aria-describedby");
      target = el;
      const model = el.dataset.modelTooltip ? JSON.parse(el.dataset.modelTooltip) : null;
      let session = null;
      if (!model && el.dataset.sessionTooltip) {
        try {
          session = JSON.parse(el.dataset.sessionTooltip);
        } catch {
          session = null;
        }
      }
      const text = model ? "模型参数" : el.dataset.tooltip || el.getAttribute("aria-label");
      if (!text && !session) return;
      timer = setTimeout(
        () => {
          const r = el.getBoundingClientRect(), list = el.closest(".chat-model-picker")?.getBoundingClientRect(),
            // Above the target there must fit the 8px gap, the tooltip body
            // and the title bar; otherwise the tooltip opens below.
            side = model || el.closest(".nav-rail") || el.hasAttribute("data-tooltip-in-menu")
              ? "right"
              : r.top - 8 - 44 < TITLEBAR + 4
                ? "bottom"
                : "top";
          el.setAttribute("aria-describedby", "withu-tooltip");
          setTip({
            text, model, session,
            side,
            rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height },
            x:
              side === "right"
                ? (model && list ? list.right : r.right) + 10
                : Math.max(80, Math.min(innerWidth - 80, r.left + r.width / 2)),
            y:
              side === "right"
                ? (model ? Math.max(100, Math.min(innerHeight-100, r.top+r.height/2)) : r.top + r.height / 2)
                : side === "bottom"
                  ? r.bottom + 8
                  : r.top - 8,
          });
        },
        Date.now() - lastClosed < 300 ? 0 : 300,
      );
    };
    const leave = (e) => {
      if (target && !target.contains(e.relatedTarget)) hide();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", hide);
    document.addEventListener("click", hide);
    document.addEventListener("keydown", hide);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      hide();
      observer.disconnect();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", hide);
      document.removeEventListener("click", hide);
      document.removeEventListener("keydown", hide);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  // Post-render safety pass: flip or clamp so the box never crosses the
  // title bar or the window edges. Runs once per tooltip (adjusted flag).
  useEffect(() => {
    const node = tipRef.current;
    if (!node || !tip || tip.adjusted) return;
    const r = node.getBoundingClientRect();
    const pad = 4, bar = TITLEBAR + 4;
    const vw = window.innerWidth, vh = window.innerHeight;
    let side = tip.side, x = tip.x, y = tip.y;
    let dirty = false;
    if (side === "top" && r.top < bar) {
      side = "bottom";
      y = tip.rect.bottom + 8;
      dirty = true;
    } else if (side === "bottom" && r.bottom > vh - pad) {
      side = "top";
      y = tip.rect.top - 8;
      dirty = true;
    }
    if (side === "right") {
      const clamped = Math.min(x, vw - pad - r.width);
      if (clamped !== x) { x = clamped; dirty = true; }
      const cy = Math.max(pad + r.height / 2, Math.min(y, vh - pad - r.height / 2));
      if (cy !== y) { y = cy; dirty = true; }
    } else {
      const cx = Math.max(pad + r.width / 2, Math.min(x, vw - pad - r.width / 2));
      if (cx !== x) { x = cx; dirty = true; }
      if (side === "bottom") {
        const ty = Math.max(bar, Math.min(y, vh - pad - r.height));
        if (ty !== y) { y = ty; dirty = true; }
      } else {
        const by = Math.max(bar + r.height, Math.min(y, vh - pad));
        if (by !== y) { y = by; dirty = true; }
      }
    }
    if (dirty) setTip((prev) => (prev ? { ...prev, side, x, y, adjusted: true } : prev));
  }, [tip]);
  return tip
    ? createPortal(
        <div
          id="withu-tooltip"
          ref={tipRef}
          role="tooltip"
          className={"withu-tooltip " + tip.side + (tip.model?" model-parameter-tooltip":"") + (tip.session?" session-info-tooltip":"")}
          style={{ left: tip.x, top: tip.y, ...(tip.model?{maxWidth:Math.max(160,innerWidth-tip.x-12)}:{}) }}
        >
          {tip.model?<><div><b>能力</b><span>{[tip.model.tool_call?'工具调用':null,tip.model.reasoning?'推理':null].filter(Boolean).join(', ')||'未提供'}</span></div><div><b>输入</b><span>{tip.model.modalities?.input?.join(', ')||'未知'}</span></div><div><b>输出</b><span>{tip.model.modalities?.output?.join(', ')||'未知'}</span></div><div><b>上下文 / 输出上限</b><span>{tip.model.limit?.context?.toLocaleString()||'未知'} / {tip.model.limit?.output?.toLocaleString()||'未知'}</span></div><div><b>成本（$/100万 tokens）</b><span>In US${tip.model.cost?.input??'未知'} · Out US${tip.model.cost?.output??'未知'}</span></div></>:tip.session?<><div className="session-tip-head"><Icon name="folder" size={14}/><b>{tip.session.title}</b></div><div className="session-tip-path">{tip.session.path}</div>{tip.session.meta&&<div className="session-tip-meta">{tip.session.meta}</div>}<div className="session-tip-time"><Icon name="bell" size={13}/><span>{tip.session.activity}</span></div></>:tip.text}
        </div>,
        document.body,
      )
    : null;
}
