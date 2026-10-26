// Overrides are route-scoped. React/CSS source remains the complete editing surface.
export function elementSelector(element) {
  const parts = [];
  while (element && element.id !== "root") {
    const siblings = [...element.parentElement.children].filter(
      (n) => n.tagName === element.tagName,
    );
    parts.unshift(
      element.tagName.toLowerCase() +
        ":nth-of-type(" +
        (siblings.indexOf(element) + 1) +
        ")",
    );
    element = element.parentElement;
  }
  return "#root > " + parts.join(" > ");
}
export function applyOverrides(overrides, route) {
  for (const change of Object.values(overrides || {})) {
    if (change.route !== route) continue;
    let element;
    try {
      element = document.querySelector(change.selector);
    } catch {
      continue;
    }
    if (!element) continue;
    if (
      change.text !== undefined &&
      !element.childElementCount &&
      element.textContent !== change.text
    )
      element.textContent = change.text;
    if (change.color) element.style.color = change.color;
    if (change.size) element.style.fontSize = change.size + "px";
    if (change.background) element.style.backgroundColor = change.background;
    if (change.radius !== undefined)
      element.style.borderRadius = change.radius + "px";
  }
}
