import memoryEnglish from './memory-translations.json' with { type: 'json' };
import modelEnglish from './model-config/translations.json' with { type: 'json' };
import dictionaries from "./translations.json" with { type: "json" };
let language = "English";
export function setLanguage(value) {
  language = value || "English";
}
export function t(value) {
  if (typeof value !== "string") return value;
  const key = value.trim(),
    translation = (language === 'English' ? (memoryEnglish[key] || modelEnglish[key]) : undefined) || dictionaries[language]?.[key];
  if (!translation) return value;
  return (
    (value.startsWith(" ") ? " " : "") +
    translation +
    (value.endsWith(" ") ? " " : "")
  );
}
