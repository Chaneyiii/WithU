import { useEffect, useRef, useState } from "react";
import "./Switch.css";

// 统一开关：胶囊轨道 + 白色圆钮。关=中性灰，开=系统蓝，全程 280ms 缓动。
// 换挡时圆钮会先横向拉伸再收回（参考案例里的 Stretch 变体），
// 这个拉伸只加在换挡的那一帧，静止时不占位、不影响布局。
export default function Switch({
  checked = false,
  onChange = () => {},
  disabled = false,
  label,
  className = "",
  ...rest
}) {
  const [anim, setAnim] = useState("");
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return undefined;
    }
    setAnim(checked ? "on" : "off");
    const timer = setTimeout(() => setAnim(""), 340);
    return () => clearTimeout(timer);
  }, [checked]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={"switch" + (checked ? " is-on" : "") + (anim ? " is-anim-" + anim : "") + (className ? " " + className : "")}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="switch-knob" />
    </button>
  );
}
