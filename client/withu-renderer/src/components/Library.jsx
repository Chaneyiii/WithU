import { t } from "../i18n";
import { useState } from "react";
import Icon, { IconButton } from "./Icon";
export const LIBRARY_ITEMS = [
  ["artifacts", "All artifacts", "library"],
  ["documents", "Documents", "document"],
  ["web", "Web artifacts", "web"],
  ["images", "Images", "image"],
  ["videos", "Videos", "video"],
  ["podcasts", "Podcasts", "podcast"],
  ["files", "System files", "folder"],
];
const iconFor = (f) =>
  /png|jpg|jpeg|webp|gif|svg/i.test(f.type)
    ? "image"
    : /mp4|mov|webm/i.test(f.type)
      ? "video"
      : /mp3|m4a|wav/i.test(f.type)
        ? "podcast"
        : "document";
export default function Library({
  view = "artifacts",
  artifacts,
  onNavigate,
  onCreate,
  onImport,
  onOpen,
  onDelete,
  onRename,
}) {
  const [sort, setSort] = useState("Last opened"),
    [mode, setMode] = useState("grid"),
    [menu, setMenu] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState([]),
    [query, setQuery] = useState("");
  let files = artifacts.filter((f) => {
    const kind = iconFor(f);
    return (
      (view === "artifacts" ||
        view === "files" ||
        (view === "documents" && kind === "document" && f.type !== "html") ||
        (view === "web" && f.type === "html") ||
        (view === "images" && kind === "image") ||
        (view === "videos" && kind === "video") ||
        (view === "podcasts" && kind === "podcast")) &&
      f.name.toLowerCase().includes(query.toLowerCase())
    );
  });
  files = [...files].sort((a, b) =>
    sort === "Title"
      ? a.name.localeCompare(b.name)
      : new Date(
          sort === "Last created" ? b.created || b.modified : b.modified,
        ) -
        new Date(
          sort === "Last created" ? a.created || a.modified : a.modified,
        ),
  );
  const createText = {
    documents: "Create a document",
    images: "Create an image",
    videos: "Create a video",
    artifacts: "Create an artifact",
    web: "Create an artifact",
  }[view];
  return (
    <section className="library-view">
      <main className="library-content">
        <header className="route-header library-page-header">
          {/* Fixed page title per the case: the largest heading stays
              "Library" regardless of the active tab, like Settings. */}
          <div><h1>{t("Library")}</h1></div>
          <div className="header-actions">
            <div className="sidebar-search library-header-search">
              <Icon name="scan" size={18} />
              <input
                aria-label={t("Search library")}
                placeholder={t("Search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {createText && (
              <button
                className="primary library-create-header"
                onClick={() => onCreate(view)}
              >
                <Icon name="plus" size={18} />
                {t(createText)}
              </button>
            )}
            {!["images", "videos", "podcasts", "files"].includes(view) && (
              <button
                className="pill"
                onClick={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}
              >
                {selecting ? t("Done") : t("Select")}
              </button>
            )}
            <div className="menu-anchor">
              <IconButton
                icon="k-sort-down"
                label={t("Sort artifacts")}
                onClick={() => setMenu(!menu)}
              />
              {menu && (
                <div className="popover sort-menu">
                  {["Last opened", "Last created", "Title"].map((label) => (
                    <button
                      key={label}
                      onClick={() => {
                        setSort(label);
                        setMenu(false);
                      }}
                    >
                      {t(label)}
                      {label === sort && <Icon name="check" size={16} />}
                    </button>
                  ))}
                  <hr />
                  {["grid", "list"].map((v) => (
                    <button
                      key={v}
                      onClick={() => {
                        setMode(v);
                        setMenu(false);
                      }}
                    >
                      {t("View as")}
                      {t(v === "grid" ? "Grid" : "List")}
                      {v === mode && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <nav className="page-tabs" role="tablist" aria-label={t("Library")}>
          {LIBRARY_ITEMS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === view}
              className={"page-tab " + (id === view ? "active" : "")}
              onClick={() => onNavigate("library/" + id)}
            >
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>
        {view === "files" && (
          <div className="file-table-header">
            <span>{t("Name")}</span>
            <span>{t("Type")}</span>
            <span>{t("Last modified")}</span>
            <span>{t("Size")}</span>
          </div>
        )}
        {files.length > 0 ? (
          <div
            className={
              mode === "list" || view === "files"
                ? "artifact-list"
                : "artifact-grid"
            }
          >
            {files.map((f) => (
              <article
                className={
                  "artifact-card " + (selected.includes(f.id) ? "selected" : "")
                }
                key={f.id}
              >
                <button
                  className="artifact-preview"
                  onClick={() =>
                    selecting
                      ? setSelected(
                          selected.includes(f.id)
                            ? selected.filter((id) => id !== f.id)
                            : [...selected, f.id],
                        )
                      : onOpen(f)
                  }
                >
                  {iconFor(f) === "image" && f.content ? (
                    <img
                      src={
                        f.content.trim().startsWith("<svg")
                          ? "data:image/svg+xml;charset=utf-8," +
                            encodeURIComponent(f.content)
                          : f.content
                      }
                      alt={f.name}
                    />
                  ) : (
                    <Icon name={iconFor(f)} size={36} />
                  )}
                </button>
                <button
                  className="artifact-name"
                  onDoubleClick={() => onRename(f)}
                  onClick={() => onOpen(f)}
                >
                  {f.name}
                </button>
                <span className="artifact-meta">
                  {f.type?.toUpperCase() || "FILE"} ·{" "}
                  {formatSize(f.size || f.content?.length || 0)}
                </span>
                <IconButton
                  icon="more"
                  label={"Rename " + f.name}
                  size={28}
                  onClick={() => onRename(f)}
                />
              </article>
            ))}
          </div>
        ) : (
          <div className="library-empty">
            {createText && (
              <button
                className="create-artifact"
                onClick={() => onCreate(view)}
              >
                <Icon name="plus" size={24} />
                <span>{t(createText)}</span>
              </button>
            )}
          </div>
        )}
        {selecting && selected.length > 0 && (
          <div className="selection-bar">
            <span>
              {selected.length}
              {t("selected")}
            </span>
            <button
              onClick={() => {
                onDelete(selected);
                setSelected([]);
              }}
            >
              {t("Remove from library")}
            </button>
          </div>
        )}
        <button className="library-import" onClick={onImport}>
          <Icon name="folder" size={18} />
          {t("Import files")}
        </button>
      </main>
    </section>
  );
}
function formatSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
