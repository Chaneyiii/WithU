import {desktopBridge} from "../desktop-bridge";
import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./Icon";
import Select from "./Select";
import { exportData } from "../store";
const scenes = ["current"];
export default function SourceStudio({ state, update, onClose }) {
  const [scene, setScene] = useState("current"),
    [selected, setSelected] = useState(null),
    [values, setValues] = useState({});
  const iframe = useRef();
  const [html, setHtml] = useState("");
  useEffect(() => { const node = document.querySelector(".application").cloneNode(true); node.querySelectorAll("script").forEach(s => s.remove()); desktopBridge().readSourceCss().then(css => setHtml("<html><head><style>" + css + "</style></head><body>" + node.outerHTML + "</body></html>")); }, []);
  const width =
      scene.startsWith("settings-") && scene !== "settings-menu" ? 1000 : 1440,
    height = width === 1000 ? 760 : 960;
  function apply(doc) {
    for (const [key, value] of Object.entries(
      state.sceneEdits?.[scene] || {},
    )) {
      const element = doc.querySelector('[data-source-node="' + key + '"]');
      if (!element) continue;
      if (value.text !== undefined) {
        const direct = [...element.childNodes].find(
          (node) => node.nodeType === 3 && node.textContent.trim(),
        );
        if (direct) direct.textContent = value.text;
        else if (!element.children.length) element.textContent = value.text;
      }
      Object.assign(element.style, value.style || {});
      for (const [attribute, text] of Object.entries(value.attributes || {}))
        element.setAttribute(attribute, text);
    }
  }
  function loaded() {
    const doc = iframe.current.contentDocument;
    if (!doc.body || !html) return;
    [...doc.body.querySelectorAll("*")].forEach((el, index) =>
      el.setAttribute("data-source-node", String(index)),
    );
    apply(doc);
    doc.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const el = event.target.closest("[data-source-node]");
        if (!el) return;
        doc.querySelector("[data-selected]")?.removeAttribute("data-selected");
        el.setAttribute("data-selected", "true");
        setSelected(el.dataset.sourceNode);
        const css = doc.defaultView.getComputedStyle(el);
        setValues({
          text: [...el.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join("")
            .trim(),
          color: css.color,
          backgroundColor: css.backgroundColor,
          fontSize: css.fontSize,
          borderRadius: css.borderRadius,
          width: css.width,
          height: css.height,
          d: el.getAttribute("d") || "",
          viewBox: el.getAttribute("viewBox") || "",
          src: el.getAttribute("src") || "",
        });
      },
      true,
    );
    const marker = doc.createElement("style");
    marker.textContent =
      "[data-selected]{outline:2px solid #0064d4!important;outline-offset:2px}";
    doc.head.append(marker);
  }
  useEffect(() => {
    if (iframe.current?.contentDocument) apply(iframe.current.contentDocument);
  }, [state.sceneEdits, scene]);
  function change(key, value) {
    setValues((prev) => ({
      ...prev,
      [key]: value,
    }));
    if (selected === null) return;
    update((prev) => {
      const old = prev.sceneEdits?.[scene]?.[selected] || {},
        edit =
          key === "text"
            ? {
                ...old,
                text: value,
              }
            : ["d", "viewBox", "src"].includes(key)
              ? {
                  ...old,
                  attributes: {
                    ...old.attributes,
                    [key]: value,
                  },
                }
              : {
                  ...old,
                  style: {
                    ...old.style,
                    [key]: value,
                  },
                };
      return {
        sceneEdits: {
          ...prev.sceneEdits,
          [scene]: {
            ...prev.sceneEdits?.[scene],
            [selected]: edit,
          },
        },
      };
    });
  }
  async function exportHtml() {
    const doc = iframe.current.contentDocument.cloneNode(true);
    doc.querySelector("[data-selected]")?.removeAttribute("data-selected");
    const css = desktopBridge()?.readSourceCss
      ? await desktopBridge().readSourceCss()
      : "";
    doc.querySelector('link[rel="stylesheet"]')?.remove();
    const style = doc.createElement("style");
    style.textContent = css;
    doc.head.append(style);
    const html = "<!doctype html>" + doc.documentElement.outerHTML;
    if (desktopBridge()?.exportHtml)
      return desktopBridge().exportHtml(scene, html);
    const blob = new Blob([html], {
        type: "text/html",
      }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = scene + "-editable.html";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="source-studio">
      <header>
        <div>
          <h2>{t("Visual studio")}</h2>
          <small>
            {t("当前界面副本 · 文字、CSS 与 SVG 可编辑")}
          </small>
        </div>
        <IconButton
          icon="close"
          label={t("Close source studio")}
          onClick={onClose}
        />
      </header>
      <div className="studio-layout">
        <aside>
          <label>
            {t("Source state")}
            <Select
              ariaLabel={t("Source state")}
              value={scene}
              align="left"
              onChange={(value) => {
                setSelected(null);
                setScene(value);
              }}
              options={scenes.map((s) => ({ value: s, label: s }))}
            />
          </label>
          <p>
            {t(
              "这是当前 Withu 界面的可编辑副本，不会执行领域操作。",
            )}
          </p>
          {[
            "text",
            "color",
            "backgroundColor",
            "fontSize",
            "borderRadius",
            "width",
            "height",
            "d",
            "viewBox",
            "src",
          ].map((key) => (
            <label key={key}>
              {key}
              {key === "text" ? (
                <textarea
                  aria-label={key}
                  value={values[key] || ""}
                  onChange={(e) => change(key, e.target.value)}
                />
              ) : (
                <input
                  aria-label={key}
                  value={values[key] || ""}
                  onChange={(e) => change(key, e.target.value)}
                />
              )}
            </label>
          ))}
          <button
            className="primary"
            onClick={() =>
              exportData({
                sceneEdits: state.sceneEdits,
              })
            }
          >
            {t("Export source edits")}
          </button>
          <button className="secondary" onClick={exportHtml}>
            {t("Export editable HTML")}
          </button>
          <label className="secondary">
            {t("Import source edits")}
            <input
              type="file"
              accept=".json"
              onChange={async (e) => {
                try {
                  const json = JSON.parse(await e.target.files[0].text());
                  if (json.sceneEdits)
                    update({
                      sceneEdits: json.sceneEdits,
                    });
                } catch {}
              }}
            />
          </label>
        </aside>
        <div className="studio-canvas">
          <iframe
            key={scene}
            ref={iframe}
            title={t("Editable Withu view")}
            srcDoc={html}
            style={{
              width,
              height,
            }}
            onLoad={loaded}
          />
        </div>
      </div>
    </section>
  );
}
