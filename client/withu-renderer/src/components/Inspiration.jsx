import { useRef, useState } from "react";
import { t } from "../i18n";
import Icon from "./Icon";
import Loader from "./Loader";
import "./Inspiration.css";
import beijing from "../assets/city-stickers/beijing.webp";
import shanghai from "../assets/city-stickers/shanghai.webp";
import guangzhou from "../assets/city-stickers/guangzhou.webp";
import chengdu from "../assets/city-stickers/chengdu.webp";
import xian from "../assets/city-stickers/xian.webp";
import hangzhou from "../assets/city-stickers/hangzhou.webp";
import chongqing from "../assets/city-stickers/chongqing.webp";
import suzhou from "../assets/city-stickers/suzhou.webp";
import lhasa from "../assets/city-stickers/lhasa.webp";
import guilin from "../assets/city-stickers/guilin.webp";

// Inspiration is a chat-topic dice: roll for a fresh hand of conversation
// prompts, then a single click sends the topic into the chat as a new thread.
const TOPICS = [
  "最近有没有哪个瞬间，你突然觉得「这样也挺好」？",
  "如果明天可以不用回消息，你想把一天花在哪里？",
  "你住过的城市里，哪个角落最让你念念不忘？",
  "最近一次发自内心笑出来，是因为什么？",
  "有没有一件小事，你一直想做但总拖着？",
  "你觉得一个人身上最难得的品质是什么？",
  "如果现在就能出发，你最想坐上哪趟车？",
  "最近在反复听哪首歌？它让你想起什么？",
  "你有没有一个「想再去一次」的地方？为什么？",
  "最近哪句话，让你想了很久？",
  "你更喜欢什么样的早晨？",
  "如果给现在的生活加一个注脚，你会写什么？",
  "你最近在为什么事情偷偷高兴？",
  "有什么看起来没用，却让你很享受的事？",
  "你会怎么向一个外星人描述「家」？",
  "最近有没有重新喜欢上什么旧东西？",
  "你心里最理想的一顿饭是什么样子？",
  "如果这周可以多出一天，你想怎么用？",
  "你最近一次改变主意，是因为什么？",
  "什么声音会让你觉得安心？",
  "你最近在学什么，或者想学什么？",
  "如果可以和十年前的自己吃顿饭，你会带 ta 去哪？",
  "你觉得「好好休息」是什么样子？",
  "最近有没有谁的一句话，让你觉得被理解了？",
  "你最喜欢的天气是什么？那种天气你通常在做什么？",
  "如果生活可以按下暂停键一天，你会停在哪里？",
  "你最近做过最勇敢的一件小事是什么？",
  "有什么习惯，是你想一直保留到很老的？",
  "你更愿意住在一座熟悉的小城，还是不断换新的地方？",
  "最近有没有一个「下次一定」的念头？",
  "你收到过最奇怪的礼物是什么？",
  "如果给今天起个标题，会是什么？",
  "你小时候最相信的一件「不真实」的事是什么？",
  "有什么事情，你只有在深夜才想得明白？",
  "你理想中的周末，从几点开始算？",
  "最近让你觉得「人类真可爱」的瞬间是什么？",
];

// Piled, not scrolled: the case footer literally heaps its stickers into two
// overlapping rows, the back one riding higher so only its upper half shows,
// and the outer cards bleeding past the page edge. Sticker widths are a share
// of the heap so the pile keeps the same density at any window size; `row`
// decides the layer, `dy` the small vertical jitter inside it.
const CITIES = [
  // 上排（后层）5 张：只被下排压住底边一点点，每张都能看全。
  { id: "suzhou", city: "苏州", landmark: "园林", image: suzhou, row: "back", w: 17.5, rotate: -5, dy: 4, z: 2 },
  { id: "chengdu", city: "成都", landmark: "安顺廊桥", image: chengdu, row: "back", w: 18, rotate: 3, dy: -6, z: 3 },
  { id: "lhasa", city: "拉萨", landmark: "布达拉宫", image: lhasa, row: "back", w: 17.5, rotate: -2, dy: 6, z: 4 },
  { id: "guangzhou", city: "广州", landmark: "广州塔", image: guangzhou, row: "back", w: 18, rotate: 5, dy: -4, z: 1 },
  { id: "hangzhou", city: "杭州", landmark: "西湖", image: hangzhou, row: "back", w: 17.5, rotate: -3, dy: 2, z: 5 },
  // 下排（前层）5 张：比上排略大、略低，像随手摊在桌上的一叠。
  { id: "beijing", city: "北京", landmark: "天坛", image: beijing, row: "front", w: 19, rotate: -6, dy: 0, z: 12 },
  { id: "shanghai", city: "上海", landmark: "外滩", image: shanghai, row: "front", w: 19.5, rotate: 4, dy: -8, z: 14 },
  { id: "xian", city: "西安", landmark: "钟楼", image: xian, row: "front", w: 19, rotate: -3, dy: 6, z: 11 },
  { id: "guilin", city: "桂林", landmark: "漓江", image: guilin, row: "front", w: 19.5, rotate: 6, dy: -2, z: 15 },
  { id: "chongqing", city: "重庆", landmark: "洪崖洞", image: chongqing, row: "front", w: 19, rotate: -4, dy: 4, z: 13 },
];

const ROWS = ["back", "front"];
const HAND = 4;
const pick = () => {
  const pool = [...TOPICS];
  const hand = [];
  while (hand.length < HAND && pool.length) {
    hand.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return hand;
};

export default function Inspiration({ onSendTopic }) {
  const [topics, setTopics] = useState(pick);
  const [rolling, setRolling] = useState(false);

  // Dragged stickers keep their own offset; `lifted` marks the one currently in
  // hand so it can rise above the heap and take the shadow.
  const [placed, setPlaced] = useState({});
  const [lifted, setLifted] = useState(null);
  const press = useRef(null);

  const clearPress = () => {
    if (!press.current) return;
    press.current = null;
    setLifted(null);
  };

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    // 换牌留出足够时间让「＋」转起来：600ms 以下动画还没走完一圈就结束了。
    setTimeout(() => {
      setTopics(pick());
      setRolling(false);
    }, 900);
  };

  // 城市贴纸是可摆放的小组件：按下就能拖，不用先长按等它醒过来。
  const onStickerDown = (city) => (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Some devices emit a second pointerdown for the same gesture; treating it
    // as a new press would reset the offset mid-drag.
    if (press.current && press.current.pointerId === event.pointerId) return;
    const current = placed[city.id] || { dx: 0, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = {
      id: city.id,
      x: event.clientX,
      y: event.clientY,
      dx: current.dx,
      dy: current.dy,
      pointerId: event.pointerId,
      node: event.currentTarget,
    };
    setLifted(city.id);
  };

  const onStickerMove = (city) => (event) => {
    const state = press.current;
    if (!state || state.id !== city.id) return;
    const dx = state.dx + (event.clientX - state.x);
    const dy = state.dy + (event.clientY - state.y);
    setPlaced((prev) => ({ ...prev, [city.id]: { dx, dy } }));
  };

  const onStickerUp = (city) => (event) => {
    const state = press.current;
    if (!state || state.id !== city.id) return;
    if (state.node?.hasPointerCapture?.(event.pointerId)) {
      state.node.releasePointerCapture(event.pointerId);
    }
    clearPress();
  };

  const sticker = (city) => {
    const offset = placed[city.id] || { dx: 0, dy: 0 };
    return (
      <button
        type="button"
        key={city.id}
        className={"city-sticker" + (lifted === city.id ? " is-lifted" : "")}
        style={{
          "--w": `${city.w}%`,
          "--rotate": `${city.rotate}deg`,
          "--dy": `${city.dy + offset.dy}px`,
          "--dx": `${offset.dx}px`,
          "--z": lifted === city.id ? 60 : city.z,
        }}
        aria-labelledby={`city-tag-${city.id}`}
        onPointerDown={onStickerDown(city)}
        onPointerMove={onStickerMove(city)}
        onPointerUp={onStickerUp(city)}
        onPointerCancel={onStickerUp(city)}
        onLostPointerCapture={clearPress}
      >
        <img src={city.image} alt="" draggable="false" loading="eager" decoding="async" />
        <span className="city-tag" id={`city-tag-${city.id}`}>
          <b>{city.city}</b>
          <i>{city.landmark}</i>
        </span>
      </button>
    );
  };

  return (
    <main className="standard-page inspiration-page">
      <div className="inspiration-top">
        <header className="inspiration-hero">
          <h1>{t("聊点什么")}</h1>
          <p>{t("不用想好开场白，随手挑一个。")}</p>
          {/* 一副摊开的牌：手势上就是把手里这几张换掉，所以按钮长得像牌堆，
              而不是一个带骰子的黑色胶囊。 */}
          <button className={"inspiration-roll" + (rolling ? " is-rolling" : "")} onClick={roll} disabled={rolling}>
            <span className="roll-deck" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="roll-copy">
              <strong>{rolling ? t("正在找…") : t("找个灵感")}</strong>
              <small>{t("换 4 个问题")}</small>
            </span>
          </button>
        </header>
        <section className="inspiration-topics" aria-label={t("此刻可以聊")}>
          <h2>{t("此刻可以聊")}</h2>
          <div className={"inspiration-grid" + (rolling ? " is-loading" : "")}>
            {topics.map((topic) => (
              <button
                key={topic}
                className="inspiration-topic"
                onClick={() => onSendTopic?.(topic)}
                disabled={rolling}
              >
                {/* 换牌时四张卡各自在文字位上转一枚「＋」，不共用一个遮罩。 */}
                {rolling ? (
                  <span className="inspiration-topic-loading">
                    <Loader size={16} />
                    <span className="topic-skeleton" aria-hidden="true">
                      <i style={{ width: "88%" }} />
                      <i style={{ width: "56%" }} />
                    </span>
                  </span>
                ) : (
                  <span className="inspiration-topic-copy">{topic}</span>
                )}
                {!rolling && (
                  <span className="inspiration-topic-go" aria-hidden="true">
                    <Icon name="arrowRight" size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="inspiration-topic-foot">
            <span>{t("点任一问题，会在新对话里发出去。")}</span>
          </div>
        </section>
      </div>

      <section className="inspiration-cities" aria-label={t("城市灵感")}>
        <header className="cities-head">
          <div>
            <h2>{t("从一座城市开始")}</h2>
            <p>{t("拖动贴纸就能摆放，拼出你喜欢的城市角落。")}</p>
          </div>
          <span className="cities-hint" aria-hidden="true">
            <Icon name="hand" size={13} />
            {t("拖动摆放 · 自由摆放")}
          </span>
        </header>
        <div className={"city-heap" + (lifted ? " is-holding" : "")}>
          {ROWS.map((row) => (
            <div className={"city-row is-" + row} key={row}>
              {CITIES.filter((city) => (city.row || "front") === row).map(sticker)}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
