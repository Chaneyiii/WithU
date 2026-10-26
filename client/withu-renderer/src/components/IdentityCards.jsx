import { MeshGradient } from "@paper-design/shaders-react";
import { t } from "../i18n";
import Icon from "./Icon";
const cards = [
  {
    key: "soul",
    title: "SOUL",
    file: "/soul.md",
    colors: ["#d4233c", "#a11b2e", "#7a1425", "#b82a3a"],
    speed: 0.23,
    swirl: 0.15,
    distortion: 0.9,
  },
  {
    key: "memory",
    title: "MEMORY",
    file: "/MEMORY.md",
    colors: ["#241d9a", "#3a4ec9", "#4b8bb5", "#2a5080"],
    speed: 0.35,
    swirl: 1,
    distortion: 0.7,
    rotation: 180,
  },
  {
    key: "app",
    title: "LOCAL APP",
    colors: ["#0f7a63", "#17a184", "#2fc9a4", "#0b5c4c"],
    speed: 0.28,
    swirl: 0.6,
    distortion: 0.8,
    rotation: 90,
  },
];
export default function IdentityCards({ state, onOpen }) {
  const reduced = matchMedia("(prefers-reduced-motion:reduce)").matches;
  return (
    <div className="identity-special-files">
      {cards.map((c) => (
        <button
          key={c.key}
          className="identity-file-card"
          aria-label={t(c.title)}
          onClick={() => onOpen(c)}
          style={{ backgroundColor: c.colors[0] }}
        >
          {!reduced && (
            <MeshGradient
              className="identity-card-gradient"
              colors={c.colors}
              speed={c.speed}
              swirl={c.swirl}
              distortion={c.distortion}
              rotation={c.rotation || 0}
              grainMixer={0.3}
              grainOverlay={0.15}
            />
          )}
          <div>
            <strong>{t(c.title)}</strong>
            <small>{t("ACCESS WITH CARE")}</small>
          </div>
          <footer>
            <span>
              {state.identityFiles?.[c.key]?.modified
                ? new Date(
                    state.identityFiles[c.key].modified,
                  ).toLocaleDateString()
                : ""}
            </span>
            <Icon name="heart" size={18} style={{ width: 24, height: 24 }} />
          </footer>
        </button>
      ))}
    </div>
  );
}
