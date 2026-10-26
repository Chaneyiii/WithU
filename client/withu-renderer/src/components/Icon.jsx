// Icon set traced 1:1 from the user-supplied 5x5 case sheet (case-icons.json).
// Every glyph is a filled path on a 24px grid with fill-rule=evenodd, so the
// outline weight and the counter holes match the sheet exactly at any size.
// A handful of pure control symbols the sheet does not carry (plus, close,
// chevrons, straight arrows, stop) are drawn with the same 2px round stroke so
// the sheet stays the single visual source; nothing else is hand-designed.
import { createContext, useContext } from "react";
import caseIcons from "../case-icons.json";
import sourceIcons from "../source-icons.json";
import { KEYLINE, KEYLINE_FILL } from "../keyline";
import { t } from "../i18n";
// WithU product logos (user-supplied art) rendered as currentColor masks.
// The `*-fill.png` companions are the same art with the petal interior flooded
// solid (outside and the ring's centre hole stay clear), so the mode mark can
// carry a flat brand colour instead of only tracing its outline.
const withuLogoModules = import.meta.glob("../assets/withu-logos/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const BRAND = { comfort: "#FF7A29", cowork: "#FFC300" };

const PATHS = caseIcons.paths;
const BEADS = caseIcons.beads;

// GO1 图标只在消息界面启用，避免改变导航、设置和系统 APP 图标。
const MessageIconContext = createContext(false);
export function MessageIconScope({ children }) {
  return <MessageIconContext.Provider value={true}>{children}</MessageIconContext.Provider>;
}

const GO1_GLYPHS = {
  call: "WithuSourceIcon20PhoneHandsetOutline24IconSVG",
  speaker: "WithuSourceIcon20SpeakerHiOutline24IconSVG",
  speakerMuted: "WithuSourceIcon20SpeakerSlashOutline24IconSVG",
  chat: "WithuSourceIcon20SpeechBubbleOutline24IconSVG",
  search: "WithuSourceIcon20SearchOutline24IconSVG",
  feed: "WithuSourceIcon20FeedPostOutline24IconSVG",
  ideas: "WithuSourceIcon20LightbulbOutline24IconSVG",
  goals: "WithuSourceBrandCheckmarkSquareOutline24IconSVG",
  library: "WithuSourceIcon20Grid4ShapesOutline24IconSVG",
  menu: "WithuSourceIcon20NaviconOutline24IconSVG",
  plus: "WithuSourceIcon20PlusOutline24IconSVG",
  send: "WithuSourceIcon20ArrowUpOutline24IconSVG",
  close: "WithuSourceIcon20XOutline24IconSVG",
  chevron: "WithuSourceIcon20ChevronRightOutline24IconSVG",
  down: "WithuSourceIcon20ChevronDownOutline24IconSVG",
  external: "WithuSourceIcon20ArrowUpRightOutline24IconSVG",
  general: "WithuSourceIcon20SettingsGearIOSOutline24IconSVG",
  connectors: "WithuSourceIcon20Grid4Outline24IconSVG",
  permissions: "WithuSourceIcon20HandStopAltOutline24IconSVG",
  devices: "WithuSourceIcon20LaptopPhoneOutline24IconSVG",
  privacy: "WithuSourceIcon20LockOutline24IconSVG",
  help: "WithuSourceIcon20CircleQuestionOutline24IconSVG",
  legal: "WithuSourceIcon20ShieldCheckOutline24IconSVG",
  logout: "WithuSourceIcon20ArrowLogoutOutline24IconSVG",
  sun: "WithuSourceIcon20SunOutline24IconSVG",
  moon: "WithuSourceIcon20MoonCrescentOutline24IconSVG",
  system: "WithuSourceIcon20MonitorOutline24IconSVG",
  document: "WithuSourceIcon20DocumentOutline24IconSVG",
  web: "WithuSourceIcon20DocumentFormatArtifactOutline24IconSVG",
  image: "WithuSourceIcon20ImageOutline24IconSVG",
  video: "WithuSourceIcon20MediaPlayOutline24IconSVG",
  podcast: "WithuSourceIcon20MusicNoteOutline24IconSVG",
  folder: "WithuSourceIcon20FolderOutline24IconSVG",
  check: "WithuSourceIcon20CheckOutline24IconSVG",
  more: "WithuSourceIcon20EllipsisOutline24IconSVG",
  back: "WithuSourceIcon20ArrowLeftOutline24IconSVG",
  forward: "WithuSourceIcon20ArrowRightOutline24IconSVG",
  sidebar: "WithuSourceIcon20SidebarClosedOutline24IconSVG",
  mic: "WithuSourceIcon20MicrophoneOutline24IconSVG",
  stop: "WithuSourceIcon20MediaStopFilled24IconSVG",
  heart: "WithuSourceIcon20HeartFilled24IconSVG",
  pencil: "WithuSourceIcon20PencilOutline24IconSVG",
  edit: "WithuSourceIcon20PencilOutline24IconSVG",
  reaction: "WithuSourceIcon20EmojiSmileOutline24IconSVG",
  reply: "WithuSourceIcon20ArrowBigReplyOutline24IconSVG",
  copy: "WithuSourceIcon20CopyOutline24IconSVG",
  share: "WithuSourceIcon20ArrowShareOutline24IconSVG",
  activity: "WithuSourceIcon20ListBulletOutline24IconSVG",
  upcoming: "WithuSourceIcon20ClockSemiCircleDashedOutline24IconSVG",
  identity: "WithuSourceIcon20FingerprintOutline24IconSVG",
  mail: "WithuSourceIcon20EnvelopeOutline24IconSVG",
};

// Control symbols: same stroke weight / cap as the traced sheet.
// Small function-key glyphs redrawn after the user-supplied thin-stroke
// arrow/chevron sheet: 2px round-cap strokes, Lucide-accurate geometry so
// chevrons, arrows and toggles read cleanly at 14-16px.
const CONTROLS = {
  plus: { d: "M12 5.1V18.9M5.1 12H18.9" },
  close: { d: "M6.1 6.1 17.9 17.9M17.9 6.1 6.1 17.9" },
  chevronRight: { d: "m9.5 5.6 6.4 6.4-6.4 6.4" },
  chevronLeft: { d: "m14.5 5.6-6.4 6.4 6.4 6.4" },
  chevronDown: { d: "m5.6 9.5 6.4 6.4 6.4-6.4" },
  chevronUp: { d: "m5.6 14.5 6.4-6.4 6.4 6.4" },
  chevronsUpDown: { d: "m8.3 9.3 3.7-3.7 3.7 3.7M8.3 14.7l3.7 3.7 3.7-3.7" },
  arrowLeft: { d: "M19 12H5.1M11.2 5.6 4.8 12l6.4 6.4" },
  arrowRight: { d: "M5 12h13.9M12.8 5.6 19.2 12l-6.4 6.4" },
  arrowUp: { d: "M12 19V5.1M5.6 11.2 12 4.8l6.4 6.4" },
  stop: { d: "M9.2 7.6h5.6a1.6 1.6 0 0 1 1.6 1.6v5.6a1.6 1.6 0 0 1-1.6 1.6H9.2a1.6 1.6 0 0 1-1.6-1.6V9.2a1.6 1.6 0 0 1 1.6-1.6Z", fill: true },
  dice: { d: "M5.6 3.2h12.8a2.4 2.4 0 0 1 2.4 2.4v12.8a2.4 2.4 0 0 1-2.4 2.4H5.6A2.4 2.4 0 0 1 3.2 18.4V5.6a2.4 2.4 0 0 1 2.4-2.4ZM8.2 8.2h.01M15.8 8.2h.01M12 12h.01M8.2 15.8h.01M15.8 15.8h.01" },
  calendar: { d: "M7.5 3.2v3M16.5 3.2v3M4.4 8.6h15.2a1.4 1.4 0 0 1 1.4 1.4v8.8a1.4 1.4 0 0 1-1.4 1.4H4.4a1.4 1.4 0 0 1-1.4-1.4V10a1.4 1.4 0 0 1 1.4-1.4ZM3 12.4h18" },
  refresh: { d: "M20 5.5v5h-5M4 18.5v-5h5M19.1 10.5A7.4 7.4 0 0 0 6.4 7.1L4 10.5M4.9 13.5a7.4 7.4 0 0 0 12.7 3.4l2.4-3.4" },
  micOff: { d: "M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1-.5 1.7M15 11.2V5M9 9.7V11a3 3 0 0 0 4.8 2.4M5.5 11a6.5 6.5 0 0 0 10.2 5.4M18.5 11a6.4 6.4 0 0 1-.7 2.9M12 17.5V21M8.5 21h7M4 4l16 16" },
  phone: { d: "M6.9 3.9 4.2 6.6c-.8.8-1.1 2-.8 3.1 1.8 5.5 6.2 9.9 11.7 11.7 1.1.4 2.3.1 3.1-.8l2.7-2.7-4.4-4.4-2.5 2.5c-2.3-1.2-4.2-3.1-5.4-5.4l2.5-2.5L6.9 3.9Z" },
};

// Slot name -> glyph. The first block is the sheet's own 25 names; the second
// maps every name the app already used onto the closest sheet glyph so no
// legacy artwork survives anywhere.
const ALIAS = {
  home: "home", window: "window", refresh: "refresh", panel: "panel", mic: "mic",
  users: "users", video: "video", like: "like", checkCircle: "checkCircle",
  scan: "scan", settings: "settings", pencil: "pencil", dots: "dots", pen: "pen",
  archive: "archive", trash: "trash", bell: "bell", pin: "pin", image: "image",
  userPlus: "userPlus", flag: "flag", expand: "expand", volume: "volume",
  lock: "lock", hand: "hand",
  // app aliases
  general: "settings", preferences: "settings", settingsGear: "settings",
  privacy: "lock", legal: "lock", secure: "lock", key: "lock", shield: "lock",
  permissions: "hand", permission: "hand", reaction: "like", heart: "like",
  activity: "k-activity-ring", feed: "dots", ideas: "dots", more: "dots", menu: "dots",
  brain: "k-brain",
  loading: "dots", thinking: "dots", spinner: "dots", help: "dots",
  goals: "k-goals", nav_goals: "k-goals", check: "checkCircle",
  done: "checkCircle", success: "checkCircle",
  library: "archive", folder: "archive", folderOpen: "archive",
  database: "archive", storage: "archive", collection: "archive",
  document: "window", file: "window", web: "window", mail: "window",
  copy: "window", system: "k-monitor", devices: "panel", layout: "panel",
  sidebar: "k-sidebar", panelLeft: "k-sidebar",
  project_web_app: "window", project_docs: "window", project_api: "window",
  search: "k-search", identity: "scan", focus: "scan", eye: "scan", eyeOff: "lock",
  speaker: "volume", speakerMuted: "k-volume-off", muted: "k-volume-off", sound: "volume",
  call: "k-phone", phone: "k-phone", meeting: "video", podcast: "video", hangup: "k-phone",
  external: "expand", fullscreen: "expand", share: "expand", logout: "expand",
  reset: "refresh", retry: "refresh", sort: "refresh", sync: "refresh",
  reply: "k-arrow-left", back: "k-arrow-left", forward: "k-arrow-right",
  send: "k-arrow-up", compose: "pen", edit: "pencil",
  chat: "k-chat", message: "window", connectors: "panel",
  sun: "k-sun", moon: "k-moon", gauge: "settings", upcoming: "bell",
  // control symbols
  plus: "plus", close: "close", chevron: "k-chevron-right",
  chevronLeft: "k-chevron-left", chevronRight: "k-chevron-right",
  chevronDown: "k-chevron-down", chevronUp: "k-chevron-up",
  down: "k-chevron-down", up: "k-chevron-up",
  chevrons: "k-chevrons-up-down", stop: "stop",
  calendar: "calendar", refresh: "refresh", dice: "dice",
  micOff: "micOff", phone: "phone",
};

function Glyph({ path, size, weight = 0 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      stroke={weight ? "currentColor" : "none"}
      strokeWidth={weight}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d={path} />
    </svg>
  );
}

function DotsGlyph({ size }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      {BEADS.map((b, i) => (
        <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={b.color} />
      ))}
    </svg>
  );
}

// Keyline Icons: one 2px keyline on the 24 grid, round caps and joins. `weight`
// thickens the stroke for the active state, the same job it does on the sheet.
function KeylineGlyph({ name, size, weight = 0 }) {
  const entry = KEYLINE[name];
  // A slot is either a plain list of stroke paths, or {stroke, fill, sw} when
  // the drawing mixes line work with solid shapes (sparkles) or needs its own
  // weight: the restored appearance icons sit at 1.9, the sort glyph is bolder.
  const mixed = !Array.isArray(entry);
  const strokePaths = mixed ? entry.stroke || [] : entry;
  const fillPaths = mixed ? entry.fill || [] : [];
  const base = mixed && entry.sw ? entry.sw : 2;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={base + weight * 0.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {strokePaths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {fillPaths.map((d, i) => (
        <path
          key={"f" + i}
          d={d}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}

function ControlGlyph({ name, size }) {
  const c = CONTROLS[name];
  if (c.fill)
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor">
        <path d={c.d} />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={c.d} />
    </svg>
  );
}

function logoUrlFor(name) {
  if (name !== "comfort" && name !== "cowork") return null;
  return (
    withuLogoModules["../assets/withu-logos/" + name + "-fill.png"] ||
    withuLogoModules["../assets/withu-logos/" + name + ".png"] ||
    null
  );
}

export default function Icon({ name, size = 24, weight = 0, ...props }) {
  const messageScope = useContext(MessageIconContext);
  // WithU product logos (comfort / cowork) render as brand-tinted masks.
  const logoUrl = logoUrlFor(name);
  if (logoUrl) {
    // Two stacked raster masks: the flooded petal carries the flat brand
    // colour, the original outline art sits on top as a darker stroke so the
    // mark keeps its edge at every size and theme.
    const STROKE = { comfort: "#8C4317", cowork: "#8C6B00" };
    const outlineUrl = withuLogoModules["../assets/withu-logos/" + name + ".png"];
    return (
      <span
        {...props}
        className={"icon icon-logo " + (props.className || "")}
        aria-hidden="true"
        style={{ width: size, height: size, ...props.style }}
      >
        <span
          className="icon-mask logo-fill"
          style={{
            "--beside-mask": 'url("' + logoUrl + '")',
            backgroundColor: BRAND[name],
          }}
        />
        {outlineUrl && (
          <span
            className="icon-mask logo-stroke"
            style={{
              "--beside-mask": 'url("' + outlineUrl + '")',
              backgroundColor: STROKE[name],
            }}
          />
        )}
      </span>
    );
  }
  const go1 = messageScope && GO1_GLYPHS[name] ? sourceIcons[GO1_GLYPHS[name]] : null;
  if (go1) {
    return (
      <span
        {...props}
        className={"icon " + (props.className || "")}
        aria-hidden="true"
        style={{ width: size, height: size, ...props.style }}
        dangerouslySetInnerHTML={{
          __html: go1
            .replace(/width="[^"]*"/, 'width="' + size + '"')
            .replace(/height="[^"]*"/, 'height="' + size + '"'),
        }}
      />
    );
  }
  const slot =
    ALIAS[name] ||
    (KEYLINE[name] || KEYLINE_FILL[name] || PATHS[name] || CONTROLS[name] ? name : "window");
  const path = PATHS[slot];
  return (
    <span
      {...props}
      className={"icon " + (props.className || "")}
      aria-hidden="true"
      style={{ width: size, height: size, ...props.style }}
    >
      {slot === "dots" ? (
        <DotsGlyph size={size} />
      ) : KEYLINE[slot] ? (
        <KeylineGlyph name={slot} size={size} weight={weight} />
      ) : KEYLINE_FILL[slot] ? (
        <Glyph path={KEYLINE_FILL[slot]} size={size} weight={weight} />
      ) : path ? (
        <Glyph path={path} size={size} weight={weight} />
      ) : (
        <ControlGlyph name={slot} size={size} />
      )}
    </span>
  );
}

// Named glyph exports let non-Icon call sites (lucide imports) switch over
// without wrapping each usage in the string API.
export function GlyphIcon({ name, size = 20, ...props }) {
  return <Icon name={name} size={size} {...props} />;
}

export function IconButton({
  icon,
  label,
  size = 32,
  iconSize = 20,
  children,
  ...props
}) {
  return (
    <button
      {...props}
      className={"icon-button " + (props.className || "")}
      aria-label={t(label)}
      title={t(label)}
      style={{
        width: size,
        height: size,
        ...props.style,
      }}
    >
      <Icon name={icon} size={iconSize} />
      {children}
    </button>
  );
}
