import { useMemo } from "react";
import { t } from "../i18n";

// Effort dial: a light capsule track, five stops, and a brain that slides along
// it. Everything behind the brain is filled with the same violet wash at every
// stop — no dot matrix, no starburst, no extra glow.
//
// Geometry is taken from the reference clip's card (track 445×44, dot 3px,
// brain 44px, 24px padding) and expressed as ratios so the module can sit in
// the model popup at any width without losing the proportions.

const STOPS_FALLBACK = 5;

function BrainGlyph() {
  // 左右两个半球 + 中间一道裂隙，比一个整圆更像大脑。
  const half = "M23 7.6c-4-2.9-11-2.1-12.6 2.7-4.6 1.4-6 7-3 10.4-1.8 5 .9 10 5.7 10.6 1.2 5.2 6.8 7.4 9.9 3.6Z";
  const strokes = [
    "M20.4 11.6c-2.2.4-3.4 2-3.2 4.2",
    "M16.6 19.4c-2.4.5-3.8 2.4-3.4 4.8",
    "M19.6 27.2c-2 1.2-2.8 3.2-2.2 5.2",
    "M21.6 16.2c1.2-.6 2.4-.2 2.8 1",
  ];
  const halves = (
    <>
      <path d={half} />
      <path d={half} transform="translate(48 0) scale(-1 1)" />
    </>
  );
  return (
    <svg className="ed-brain" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      {/* 两套配色叠在一起，靠透明度交叉淡入：低档品红，极高/最高转蓝紫。 */}
      <g className="ed-layer ed-layer-pink" fill="url(#ed-brain-fill)">{halves}</g>
      <g className="ed-layer ed-layer-hot" fill="url(#ed-brain-fill-hot)">{halves}</g>
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round" strokeWidth="1.3" opacity=".5">
        {strokes.map((d) => <path key={d} d={d} />)}
        {strokes.map((d) => <path key={d + "r"} d={d} transform="translate(48 0) scale(-1 1)" />)}
      </g>
      <g fill="none" stroke="#FFFFFF" strokeOpacity=".32" strokeWidth="1">{halves}</g>
    </svg>
  );
}

export default function EffortDial({
  options,
  value,
  onChange,
  onCommit,
  labels = {},
  label = "思考强度",
  hint = "推荐",
  model = "",
  disabled = false,
}) {
  const stops = options.length ? options : Array(STOPS_FALLBACK).fill("");
  const index = Math.max(0, options.indexOf(value));
  const ratio = stops.length > 1 ? index / (stops.length - 1) : 0;
  // 极高、最高两档：大脑从品红转成蓝紫，其余档位保持普通紫色填充。
  const hot = index >= stops.length - 2 && stops.length > 2;
  // 所有档位共用一套普通的紫色填充：不做点阵、不做粒子、也不额外发光。
  const style = useMemo(() => ({ "--ed-ratio": ratio.toFixed(4) }), [ratio]);

  return (
    <div className={"effort-dial" + (disabled ? " is-disabled" : "") + (hot ? " is-hot" : "")} style={style}>
      <svg className="ed-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="ed-brain-fill" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFB3DC" />
            <stop offset=".38" stopColor="#F0479F" />
            <stop offset=".72" stopColor="#C22BB4" />
            <stop offset="1" stopColor="#7C3AED" />
          </linearGradient>
          <linearGradient id="ed-brain-fill-hot" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#D6C7FF" />
            <stop offset=".38" stopColor="#9A78FF" />
            <stop offset=".72" stopColor="#6E4AE8" />
            <stop offset="1" stopColor="#4A28C9" />
          </linearGradient>
        </defs>
      </svg>

      {model ? <span className="ed-model">{model}</span> : null}

      <header className="ed-head">
        <span className="ed-label">{label}</span>
        <strong className="ed-value">{labels[value] || value || "—"}</strong>
        <span
          className="ed-help"
          data-tooltip={t("拖动滑杆调节模型思考强度；更换默认模型请到 设置 → 通用。")}
          aria-label={t("拖动滑杆调节模型思考强度；更换默认模型请到 设置 → 通用。")}
        >
          ?
        </span>
      </header>

      <div className="ed-ends">
        <span>更快</span>
        <span>更聪明</span>
      </div>

      <div className="ed-track">
        <div className="ed-fill" />

        <div className="ed-dots" aria-hidden="true">
          {stops.map((stop, i) => (
            // 当前档位的圆点正好压在脑柄下面，脑图标的透明边缘会把它露出来，
            // 直接隐藏（脑柄盖住的位置本来也看不见它）。
            <i key={stop + i} className={i === index ? "is-hidden" : i <= index ? "is-lit" : ""} />
          ))}
        </div>

        <i className="ed-recommend" aria-hidden="true" />

        <div className="ed-thumb">
          <BrainGlyph />
        </div>

        <input
          className="ed-range"
          type="range"
          min="0"
          max={Math.max(0, stops.length - 1)}
          step="1"
          value={index}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={labels[value] || value || ""}
          onChange={(event) => onChange?.(options[Number(event.target.value)], Number(event.target.value))}
          onPointerUp={() => onCommit?.(value)}
          onKeyUp={() => onCommit?.(value)}
        />
      </div>

      <span className="ed-caption">{hint}</span>
    </div>
  );
}
