import { t } from "../i18n";
import { useEffect, useRef } from "react";
import { IconButton } from "./Icon";
export default function Modal({
  title,
  children,
  onClose,
  wide = false,
  footer,
}) {
  const ref = useRef();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  function key(e) {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      const ns = [
        ...ref.current.querySelectorAll("button,input,textarea,select,a[href]"),
      ].filter((n) => !n.disabled);
      if (!ns.length) return;
      const first = ns[0],
        last = ns.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        ref={ref}
        tabIndex={-1}
        onKeyDown={key}
      >
        <header>
          <h2>{t(title)}</h2>
          <IconButton icon="close" label={t("Close")} onClick={onClose} />
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}
