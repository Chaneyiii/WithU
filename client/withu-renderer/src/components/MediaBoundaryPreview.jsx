import { t } from '../i18n';
import Icon from './Icon';

export function MediaScreen() {
  return <div className="projected-media-screen" aria-label={t("媒体屏幕预览")}><Icon name="video" size={25}/><span>{t("媒体画面占位 · 未播放媒体")}</span></div>;
}

export function MediaControls({ captions, setCaptions }) {
  return <>
    <button className="control-disabled" disabled aria-label={t("麦克风未连接")} title={t("语音服务未连接")}><Icon name="mic" size={15}/><span>{t("按住说话")}</span></button>
    <button className={captions ? 'selected' : ''} aria-pressed={captions} onClick={() => setCaptions(value => !value)}><Icon name="document" size={15}/><span>{t(captions ? '字幕 开' : '字幕 关')}</span></button>
    <button className="control-disabled" disabled aria-label={t("停止播放不可用")} title={t("播放器未连接")}><Icon name="stop" size={15}/><span>{t("停止")}</span></button>
    <span className="quiet-presence">{t("安静陪伴")}</span>
  </>;
}
