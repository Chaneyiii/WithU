import { useState, useEffect, useRef } from "react";
import { IconButton, MessageIconScope } from "./Icon";
import { exportData, openExternal } from "../store";
import { t } from "../i18n";
const reactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
export default function MessageActions({
  message,
  onReply,
  onReaction,
  onEdit,
  onCopy,
  onMore,voiceAction,
}) {
  const [menu, setMenu] = useState(false),
    [reactionPicker, setReactionPicker] = useState(false);
  const sources = message.sources || [];
  const root = useRef();
  useEffect(() => {
    if (!menu && !reactionPicker) return;
    const dismiss = (e) => {
      if (e.key === "Escape" || !root.current?.contains(e.target)) {
        setMenu(false);
        setReactionPicker(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [menu, reactionPicker]);
  return (
    <MessageIconScope>
    <div className="message-interactions" ref={root}>
      <div className="message-toolbar">
        <IconButton
          icon="reply"
          label={t("Reply")}
          size={28}
          iconSize={16}
          onClick={() => onReply(message)}
        />
        <IconButton
          icon="copy"
          label={t("Copy")}
          size={28}
          iconSize={16}
          onClick={() => onCopy(message.text)}
        />
        <IconButton
          icon="reaction"
          label={t("Quick reactions")}
          size={28}
          iconSize={16}
          onClick={() => {
            setMenu(false);
            setReactionPicker(!reactionPicker);
          }}
        />
        <IconButton
          icon="share"
          label={t("Share")}
          size={28}
          iconSize={16}
          onClick={() =>
            exportData({
              type: "message-share",
              message,
            })
          }
        />
        {voiceAction}
        <div className="menu-anchor">
          <IconButton
            icon="more"
            label={t("More message actions")}
            size={28}
            iconSize={16}
            onClick={() => {
              setReactionPicker(false);
              setMenu(!menu);
            }}
          />
          {menu && (
            <div className="popover message-menu">
              <button
                onClick={() => {
                  onReply(message);
                  setMenu(false);
                }}
              >
                {t("Reply")}
              </button>
              <button
                onClick={() => {
                  onCopy(message.text);
                  setMenu(false);
                }}
              >
                {t("Copy")}
              </button>
              <button
                onClick={() => {
                  onEdit(message);
                  setMenu(false);
                }}
              >
                {t("Edit message")}
              </button>
              {sources.length > 0 && (
                <button
                  onClick={() => {
                    onMore(message);
                    setMenu(false);
                  }}
                >
                  {t("See sources")}
                </button>
              )}
              <small>{new Date(message.created).toLocaleString()}</small>
            </div>
          )}
        </div>
      </div>
      {reactionPicker && (
        <div
          className="reaction-rail"
          role="group"
          aria-label={t("Quick reactions")}
        >
          {reactions.map((emoji) => (
            <button
              aria-label={t("React with") + " " + emoji}
              aria-pressed={message.reactions?.includes(emoji) || false}
              key={emoji}
              onClick={() => {
                onReaction(message.id, emoji);
                setReactionPicker(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
    </MessageIconScope>
  );
}
