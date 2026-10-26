import {useCallback, useEffect, useRef, useState} from "react";
import {t} from "../i18n";
import McpAppHost from "./McpAppHost";
import "./browser-drawer.css";

// 起始页和渲染层同源，打包后就是 dist/garden.html。
const HOME_PAGE = new URL("./garden.html", location.href).href;
const SEARCH = "https://www.bing.com/search?q=";

// 主进程打开 webviewTag 才有真正的浏览器；万一没开，退化成 iframe。
const WEBVIEW_OK = (() => {
  try { return typeof document.createElement("webview").loadURL === "function"; } catch { return false; }
})();

function looksLikeUrl(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  return /^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/i.test(value);
}

function toUrl(value, home) {
  const query = value.trim();
  if (!query) return home;
  if (looksLikeUrl(query)) return /^[a-z][a-z0-9+.-]*:\/\//i.test(query) ? query : `https://${query}`;
  return SEARCH + encodeURIComponent(query);
}

/**
 * 主舞台底部的浏览器抽屉。
 * 收起时只有一颗液态玻璃小胶囊，浮在消息列表底部；
 * 点开以后这颗胶囊自己升上去、长成关闭 + 搜索的灵动岛，抽屉在它下面滑出来。
 * 抽屉里是真实的 Chromium 页面（webview），默认停在 WithU 起始页。
 */
export default function BrowserDrawer({open, available = false, onOpen, onClose, entry = HOME_PAGE, theme = "light", appMode = false, navigateTo = null}) {
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const viewRef = useRef(null);
  const inputRef = useRef(null);
  const [draft, setDraft] = useState("");
  // 灵动岛标签：非编辑态显示页面标题（浏览器标签页语义），点击才进入网址编辑。
  const [pageTitle, setPageTitle] = useState("");
  const [editing, setEditing] = useState(false);
  // 起始页的纸面颜色跟着应用的明暗走，所以入口地址带上主题。
  const home = entry === HOME_PAGE ? `${HOME_PAGE}?theme=${theme}` : entry;
  // webview 的 src 只认第一次的值，之后换页走 loadURL，免得 React 重设属性把页面拽回去。
  const firstSrc = useRef(home);
  const [url, setUrl] = useState(home);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // 全屏 = 抽屉铺满整个主舞台；canBack/canForward 决定前进后退要不要变灰。
  const [full, setFull] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  // webview 只有在元素真正有尺寸时创建，访客页才会拿到正确的视口。
  const [mounted, setMounted] = useState(false);
  // 偶发情况：webview 建好了但访客视口还是整窗大小，自检不一致就重建一次。
  const [epoch, setEpoch] = useState(0);
  const repairs = useRef(0);

  // 应用切明暗时，起始页换纸面颜色 —— 直接改访客页的 data-theme，不重新载入。
  useEffect(() => {
    if (!mounted || !WEBVIEW_OK) return;
    const view = viewRef.current;
    if (!view) return;
    try {
      view.executeJavaScript(`window.__withuTheme&&window.__withuTheme(${JSON.stringify(theme)})`);
    } catch { /* 访客页还没准备好 */ }
  }, [theme, mounted]);

  // 胶囊要升多高由 CSS 算（输入框自己把高度写进 --composer-rest，见 Composer）。

  // 第一次打开时等抽屉滑到位再挂 webview（访客页才有正确的视口）；
  // 挂上以后就不再卸载，再次展开是瞬时的，也不会每次开都卡一下。
  useEffect(() => {
    if (!open) return undefined;
    repairs.current = 0;
    if (mounted) return undefined;
    const raise = setTimeout(() => setMounted(true), 900);
    return () => clearTimeout(raise);
  }, [open, mounted]);

  // 访客视口和元素尺寸对不上时，重建一次 webview 通常就好了（最多试两次）。
  // 抽屉高度会跟着舞台变，所以要盯几个时间点，也要盯住视口自己的尺寸变化。
  useEffect(() => {
    if (!open || !mounted || !WEBVIEW_OK) return undefined;
    let busy = false;
    const check = () => {
      const view = viewRef.current;
      if (busy || !view || !view.executeJavaScript) return;
      busy = true;
      const height = view.getBoundingClientRect().height;
      view.executeJavaScript("innerHeight")
        .then((inner) => {
          busy = false;
          if (Math.abs(inner - height) < 2) return;
          if (repairs.current >= 2) return;
          repairs.current += 1;
          setEpoch((value) => value + 1);
        })
        .catch(() => { busy = false; });
    };
    const timers = [900, 2000].map((delay) => setTimeout(check, delay));
    const view = viewRef.current?.parentElement;
    const observer = view ? new ResizeObserver(check) : null;
    observer?.observe(view);
    window.addEventListener("resize", check);
    return () => {
      timers.forEach(clearTimeout);
      observer?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [open, mounted, epoch]);

  // 打开时收拾一下输入框；只有真的跑偏了才重新载入口页，别每次都重载。
  // 由对话导航指令（navigateTo）触发的打开除外：那正是要去的搜索页。
  useEffect(() => {
    if (!open) return undefined;
    setDraft("");
    setFailed(false);
    const timer = setTimeout(() => {
      const view = viewRef.current;
      if (!view || typeof view.getURL !== "function") return;
      try {
        const recentNav = lastNavAt.current && Date.now() - lastNavAt.current < 4000;
        if (!recentNav && view.getURL().split("?")[0] !== HOME_PAGE) view.loadURL(home);
      } catch { /* webview 还没挂上，下一拍再说 */ }
    }, 80);
    return () => clearTimeout(timer);
  }, [open, home, mounted]);

  // webview 是 Electron 的自定义元素，事件只能挂在实例上。
  useEffect(() => {
    const view = viewRef.current;
    if (!WEBVIEW_OK || !view || typeof view.addEventListener !== "function") return undefined;
    const start = () => { setLoading(true); setFailed(false); };
    const stop = () => { setLoading(false); syncHistory(); };
    const title = (event) => {
      // 页面标签：优先用页面自报的标题（soul/memory/app 文档页会把
      // document.title 设成自己的名字）；离开编辑态显示标签而不是网址。
      const next = (event?.title || "").trim();
      if (next) setPageTitle(next);
    };
    const nav = (event) => {
      const next = event.url || "";
      setUrl(next);
      setDraft(next.split("?")[0] === HOME_PAGE ? "" : next);
      setEditing(false);
      // 本地文档页（soul.html?page=…）没有像样的标题事件时，按文件名给标签。
      try {
        const u = new URL(next);
        if (u.protocol === "file:") {
          const base = u.pathname.split("/").pop() || "";
          const page = u.searchParams.get("page");
          setPageTitle(page || base.replace(/\.html?$/i, "") || "page");
        } else {
          setPageTitle(u.hostname || "page");
        }
      } catch { /* 非法地址就先不动标签 */ }
      syncHistory();
    };
    // 只认主框架真的加载失败；-3 是被主动打断（换页、重定向），不算错。
    const fail = (event, errorCode, _desc, _url, isMainFrame) => {
      const main = event?.isMainFrame ?? isMainFrame;
      const code = event?.errorCode ?? errorCode;
      if (main === false) return;
      if (!code || code === -3) return;
      setLoading(false);
      setFailed(true);
    };
    view.addEventListener("did-start-loading", start);
    view.addEventListener("did-stop-loading", stop);
    view.addEventListener("did-navigate", nav);
    view.addEventListener("did-navigate-in-page", nav);
    view.addEventListener("page-title-updated", title);
    view.addEventListener("did-fail-load", fail);
    syncHistory();
    return () => {
      view.removeEventListener("did-start-loading", start);
      view.removeEventListener("did-stop-loading", stop);
      view.removeEventListener("did-navigate", nav);
      view.removeEventListener("did-navigate-in-page", nav);
      view.removeEventListener("page-title-updated", title);
      view.removeEventListener("did-fail-load", fail);
    };
  }, [mounted]);

  // 退不回去就把「后退」按灰，和真浏览器一致。
  const syncHistory = useCallback(() => {
    const view = viewRef.current;
    if (!view || typeof view.canGoBack !== "function") return;
    try {
      setCanBack(view.canGoBack());
      setCanForward(view.canGoForward());
    } catch {
      setCanBack(false);
      setCanForward(false);
    }
  }, []);

  const travel = useCallback((action) => {
    const view = viewRef.current;
    if (!view) return;
    try {
      if (action === "back" && view.canGoBack()) view.goBack();
      if (action === "forward" && view.canGoForward()) view.goForward();
      if (action === "reload") view.reload();
    } catch { /* 访客页还没准备好 */ }
  }, []);

  // 收起时退出全屏，下次打开还是标准 16:10。
  useEffect(() => {
    if (!open) setFull(false);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const timer = setTimeout(() => inputRef.current?.focus({preventScroll: true}), 640);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [open, onClose]);

  const go = useCallback((value) => {
    const next = toUrl(value, home);
    setFailed(false);
    setUrl(next);
    if (!WEBVIEW_OK) return;
    try { viewRef.current?.loadURL(next); } catch { setFailed(true); }
    if (next === home) setDraft("");
  }, [home]);

  // 对话里的联网需求（[[surface:web:…]] 标记）直接驱动抽屉打开并搜索：
  // nonce 变化即一次新的导航指令，抽屉打开后立即载入目标地址；
  // webview 还没挂载时把地址记进 firstSrc，挂载即落在目标页。
  const lastNav = useRef(null);
  const lastNavAt = useRef(0);
  useEffect(() => {
    if (!navigateTo || !navigateTo.nonce || !navigateTo.url) return;
    if (lastNav.current === navigateTo.nonce) return;
    lastNav.current = navigateTo.nonce;
    lastNavAt.current = Date.now();
    if (!open) return;
    const next = toUrl(navigateTo.url, home);
    if (!viewRef.current) firstSrc.current = next;
    setUrl(next);
    setDraft("");
    go(navigateTo.url);
  }, [navigateTo, open, go, home]);

  // 一开始输入或者已经离开起始页，工具栏就撑满整条抽屉。
  const away = url.split("?")[0] !== HOME_PAGE;
  const wide = open && (draft.trim().length > 0 || away);
  const cls = ["browser-drawer", open ? "is-open" : "", full ? "is-full" : "", wide ? "is-wide" : "", available || open ? "is-ready" : ""].filter(Boolean).join(" ");
  const tab = open ? 0 : -1;

  return (
    <div className={cls} ref={rootRef} aria-hidden={!open}>
      <div className="browser-sheet" ref={sheetRef}>
        <div className="browser-view">
          {appMode ? (
            /* MCP App 模式：面板里直接挂 MCP App 会话（审批/意图照常可用），
               网页 webview 暂时让位，收起抽屉后自动切回。 */
            <div className="browser-app-host">
              <McpAppHost variant="inline" />
            </div>
          ) : (
            <>
              {loading && <i className="browser-progress" />}
              {WEBVIEW_OK ? (
                mounted ? (
                  <webview
                    ref={viewRef}
                    src={firstSrc.current}
                    partition="persist:withu-browser"
                    className="browser-webview"
                  />
                ) : null
              ) : (
                <iframe className="browser-webview" src={url} title={t("浏览器")} />
              )}
              {failed && (
                <div className="browser-failed" role="status">
                  <p>{t("这个地址打不开，换个试试。")}</p>
                  <button type="button" onClick={() => go("")}>{t("回到起始页")}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 一根指示条的两种形态：收起时贴着消息框，展开后是浏览器工具栏 */}
      <div className="browser-pill-track">
      <div className="browser-pill">
        <div className="pill-nav" role="group" aria-label={t("页面导航")}>
          <button type="button" onClick={() => travel("back")} disabled={!canBack} aria-label={t("后退")} tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14.8 5.6L8.4 12l6.4 6.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button type="button" onClick={() => travel("forward")} disabled={!canForward} aria-label={t("前进")} tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9.2 5.6L15.6 12l-6.4 6.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button type="button" onClick={() => travel("reload")} aria-label={t("重新加载")} tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              <path d="M19.5 4.4v4.3h-4.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {open && away && !editing ? (
          /* 标签态：像浏览器标签页一样显示页面标题，点击进入编辑才露出网址 */
          <button
            type="button"
            className="pill-tab"
            onClick={() => {
              setEditing(true);
              setDraft(url);
              setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
              }, 40);
            }}
            tabIndex={tab}
            title={url}
          >
            <span className="pill-tab-dot" aria-hidden="true" />
            <span className="pill-tab-label">{pageTitle || t("页面")}</span>
          </button>
        ) : (
          <form
            className="pill-search"
            onSubmit={(event) => {
              event.preventDefault();
              go(draft);
              setEditing(false);
              inputRef.current?.blur();
            }}
          >
            <svg className="pill-glass" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.7"/>
              <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => { if (away) setEditing(false); }}
              onKeyDown={(event) => { if (event.key === "Escape") { setEditing(false); event.currentTarget.blur(); } }}
              placeholder={t("搜索，或输入网址")}
              spellCheck="false"
              autoComplete="off"
              tabIndex={tab}
              readOnly={!open}
            />
          </form>
        )}

        <button
          className="pill-full"
          type="button"
          onClick={() => setFull((value) => !value)}
          aria-label={full ? t("退出全屏") : t("全屏")}
          tabIndex={tab}
        >
          {full ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9.5 4.5v5h-5M14.5 19.5v-5h5M19.5 9.5h-5v-5M4.5 14.5h5v5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.5 9.5v-5h5M19.5 14.5v5h-5M14.5 4.5h5v5M9.5 19.5h-5v-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <button className="pill-x" type="button" onClick={onClose} aria-label={t("收起抽屉")} tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        <button className="pill-trigger" type="button" onClick={() => { if (available || open) onOpen?.(); }} aria-label={t("打开抽屉")} tabIndex={open || !available ? -1 : 0}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 14.5l6-5.6 6 5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>{t("浏览器")}</span>
        </button>
      </div>
      </div>
    </div>
  );
}

export {HOME_PAGE};
