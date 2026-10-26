# GUI 来源记录（工程事实）

唯一产品权威为 docs/product/withu-v3-spec.md。
源 GUI：E:/museee/GUI/source。README/design-qa 声明 React/Electron 代码为自研，图标、主题语义和部分 CSS 来自 Muse 7.0 DMG 提取资源。
来源没有单独 LICENSE。2026-10-10 用户明确确认“自研代码及提取资产使用权”；此记录不将来源代码重新授予第三方许可证。
逐块迁入 React 组件、CSS、Tooltip、主题/i18n、图标与 SOUL/MEMORY shader；未复制 node_modules、dist、EXE、离线编译 bundle、历史 QA 或测试结论。
原品牌头像与应用图标未迁入；Withu SVG/PNG/ICO 为本仓库新绘制。
原提取图标名称转换为 WithuSource，保留通用几何；账户、钱包和安全存储入口移除。
ZCode 固定快照 29628c9acdb81b703bbd4080c207a0e7ce5e276e 已只读核对 LICENSE（Apache-2.0）、NOTICE.md 和会话/composer 文件；当前只参考会话中心及隐藏输入语义，未复制其源码或运行依赖。
@paper-design/shaders-react、React、Electron 等许可证由 npm 包提供，后续打包须随依赖保留。

2026-10-11 v0.3alpha1：从相同授权源恢复 RecordingStrip.jsx 与对应 refinements.css，4px bar/8px step/5秒历史/50ms采样，接真实 RMS。仅移除源品牌命名并映射主题色；未复制 Unsloth/其他 AGPL 录音组件。

2026-10-12 alpha7：从已授权的同源 svg-icons 恢复 MetaIcon20 PhoneHandsetOutline、SpeakerHiOutline、SpeakerSlashOutline 通用几何；只转换本仓库标识，沿用既有资产授权。思考能力复用 P1 Composer 的 effort-slider/effort-ticks/effort-reset 与原 CSS，档位由 models.dev 提供。
