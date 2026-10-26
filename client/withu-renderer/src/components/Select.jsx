import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import "./select.css";

/**
 * 应用内的下拉选择。
 * 原生 <select> 在 Windows 上会弹出系统菜单，和整套玻璃皮肤割裂；
 * 这里自己画一条胶囊 + 一张浮层，点击外部 / Esc / 滚动都能收起来。
 *
 * 浮层挂在 body 上并用 fixed 定位：设置卡本身 overflow:hidden，
 * 留在原地会被裁掉，只有门户才盖得到卡片外面。
 *
 * options: [{ value, label }]
 */
export default function Select({
  value,
  options = [],
  onChange,
  ariaLabel,
  disabled = false,
  align = "right",
  ...rest
}) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(null);
  const root = useRef(null);

  const place = () => {
    const trigger = root.current?.querySelector(".withu-select-trigger");
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const width = Math.max(box.width, 112);
    const height = options.length * 32 + 10;
    const below = box.bottom + 6;
    const left = align === "left" ? box.left : box.right - width;
    setSpot({
      top: below + height > window.innerHeight - 8 ? Math.max(8, box.top - 6 - height) : below,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      width,
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      const inMenu = event.target?.closest?.(".withu-select-menu");
      if (!root.current?.contains(event.target) && !inMenu) setOpen(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    // 滚轮落在浮层外面才收起；在浮层里面滚动（选项多的时候）不能碰它，
    // 否则正在滚的节点被当场卸掉会带崩渲染进程。
    const wheel = (event) => {
      if (!event.target?.closest?.(".withu-select-menu")) setOpen(false);
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

  const current = options.find((option) => String(option.value) === String(value));
  return (
    <div className={"withu-select" + (open ? " is-open" : "")} ref={root}>
      <button
        type="button"
        className="withu-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
        {...rest}
      >
        <span>{current?.label ?? ""}</span>
        <Icon name="chevrons" size={14} />
      </button>
      {open &&
        spot &&
        createPortal(
          <div
            className="withu-select-menu is-floating"
            role="listbox"
            aria-label={ariaLabel}
            style={{ top: spot.top, left: spot.left, minWidth: spot.width }}
          >
            {options.map((option) => {
              const active = String(option.value) === String(value);
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? "active" : ""}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onChange?.(option.value);
                  }}
                >
                  <span>{option.label}</span>
                  {active && <Icon name="check" size={14} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
