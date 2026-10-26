import { useEffect, useId, useRef } from "react";

const TAU = Math.PI * 2;
// Band widths are tuned against the reference frames: the satin sheet there is
// roughly a third of the card tall at its widest, with two soft folds riding on
// top of the main ribbon instead of a thin equal-width pipe.
const BANDS = [
  { name: "back", phase: -0.36, width: 57, offset: 3, opacity: 0.72 },
  { name: "front", phase: 0.12, width: 52, offset: 0, opacity: 0.9 },
  { name: "fold", phase: 0.46, width: 36, offset: -4, opacity: 0.66 },
];

function ribbonPath(time, energy, band) {
  const upper = [];
  const lower = [];
  const phase = time * 0.67 + Math.sin(time * 0.21) * 0.22;
  const frequency = 1.17 + Math.sin(time * 0.17) * 0.08;

  for (let i = 0; i <= 36; i += 1) {
    const x = -36 + (772 * i) / 36;
    const u = x / 700;
    const angle = u * TAU * frequency - phase;
    const envelope = 0.76 + 0.24 * Math.sin(u * Math.PI + time * 0.26);
    const center = 165 + band.offset
      + Math.sin(angle + band.phase) * (20 + energy * 17)
      + Math.sin(u * Math.PI * 0.86 + time * 0.3) * 12;
    // 有符号厚度让两条边缘自然交汇，形成丝带翻面，而非等宽正弦管道。
    const twist = Math.sin(angle + 0.65 + band.phase + Math.sin(time * 0.24) * 0.23);
    const halfWidth = band.width * (0.46 + energy * 0.62) * envelope * twist;
    const drape = Math.sin(angle - 0.5) * (3 + energy * 5);
    upper.push([x, center - halfWidth + drape]);
    lower.push([x, center + halfWidth + drape]);
  }

  function curve(points, command) {
    let path = `${command}${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      path += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${
        (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return path;
  }

  return `${curve(upper, "M")}${curve(lower.reverse(), "L")}Z`;
}

const STILL_PATHS = BANDS.map((band) => ribbonPath(0, 0.42, band));

export default function LiveWave({ level = 0, speaking = false, muted = false, active = true }) {
  const id = `live-wave-${useId().replace(/:/g, "")}`;
  const paths = useRef([]);
  const controls = useRef({ level: 0, speaking, muted });
  const motion = useRef({ time: 0, energy: 0.42, speed: 0.8 });

  useEffect(() => {
    controls.current = {
      level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0,
      speaking,
      muted,
    };
  }, [level, speaking, muted]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastTime = null;
    let disposed = false;

    function draw() {
      BANDS.forEach((band, index) => {
        paths.current[index]?.setAttribute("d", ribbonPath(motion.current.time, motion.current.energy, band));
      });
    }

    function tick(now) {
      if (disposed) return;
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const input = controls.current;
      const energy = input.muted ? 0.04 : (input.speaking ? 0.55 : 0.36) + input.level * 0.4;
      const speed = input.muted ? 0.28 : (input.speaking ? 1.04 : 0.8) + input.level * 0.16;
      const smoothing = 1 - Math.exp(-dt * 3.2);
      motion.current.energy += (energy - motion.current.energy) * smoothing;
      motion.current.speed += (speed - motion.current.speed) * smoothing;
      motion.current.time += dt * motion.current.speed;
      draw();
      frame = window.requestAnimationFrame(tick);
    }

    function syncMotion() {
      window.cancelAnimationFrame(frame);
      lastTime = null;
      if (!active || document.hidden || preference.matches) {
        draw();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    }

    syncMotion();
    preference.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      preference.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, [active]);

  return (
    <div
      className={"live-wave" + (speaking ? " is-speaking" : "") + (muted ? " is-muted" : "") + (!active ? " is-inactive" : "")}
      style={{ "--live-level": Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0 }}
      aria-hidden="true"
    >
      <svg viewBox="0 30 700 310" preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <linearGradient id={`${id}-back`} gradientUnits="userSpaceOnUse" x1="0" y1="115" x2="700" y2="205">
            <stop offset="0" stopColor="#FFF1D2" stopOpacity="0.82" />
            <stop offset=".25" stopColor="#FFE6AF" />
            <stop offset=".52" stopColor="#FFAC60" stopOpacity="0.75" />
            <stop offset=".76" stopColor="#FFE2AE" />
            <stop offset="1" stopColor="#FFF2D8" stopOpacity="0.7" />
          </linearGradient>
          <linearGradient id={`${id}-front`} gradientUnits="userSpaceOnUse" x1="60" y1="195" x2="620" y2="125">
            <stop offset="0" stopColor="#FFE9BD" stopOpacity="0.64" />
            <stop offset=".18" stopColor="#FFD298" stopOpacity="0.87" />
            <stop offset=".38" stopColor="#FF8C36" />
            <stop offset=".56" stopColor="#FF5D15" />
            <stop offset=".78" stopColor="#FF7530" />
            <stop offset="1" stopColor="#FFC783" stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id={`${id}-fold`} gradientUnits="userSpaceOnUse" x1="100" y1="115" x2="640" y2="215">
            <stop offset="0" stopColor="#FFF9E9" stopOpacity="0.25" />
            <stop offset=".25" stopColor="#FFFAED" stopOpacity="0.94" />
            <stop offset=".44" stopColor="#FFF6DF" stopOpacity="0.84" />
            <stop offset=".59" stopColor="#FFBE83" stopOpacity="0.08" />
            <stop offset=".8" stopColor="#FFF1D6" stopOpacity="0.86" />
            <stop offset="1" stopColor="#FFE9BC" stopOpacity="0.4" />
          </linearGradient>
          <filter id={`${id}-soft`} x="-5%" y="-20%" width="110%" height="140%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="0.7" />
          </filter>
        </defs>
        <g filter={`url(#${id}-soft)`}>
          {BANDS.map((band, index) => (
            <path
              key={band.name}
              ref={(node) => { paths.current[index] = node; }}
              className={`live-wave-layer ${band.name}`}
              d={STILL_PATHS[index]}
              fill={`url(#${id}-${band.name})`}
              opacity={band.opacity}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
