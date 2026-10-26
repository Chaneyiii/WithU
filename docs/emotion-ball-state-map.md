# Withu · lumi 交互球对照

当前布局（2026-10-14最终收尾）：固定48px顶栏与68px左栏；活动和Live面板高:宽19.5:9、等高并与消息区相接。通话球与活动球统一132×132px，复用同一尺寸声明。Live仅记录时长摘要，电平条为暖阳液态玻璃。原状态映射与交互保持；下面尺寸与布局增量为历史记录。

来源：用户指定会话 `codex://threads/01a1366d-6065-7672-a6f6-0b4c3920e894` 的最终 `C:/Users/yueeh/Documents/Codex/2026-10-14/yo/outputs/voice-orb.html`。复用流动材质、固定玻璃外壳、不规则光晕、表情和最后一版右→中→左电平条，提取为独立渲染组件。原文件保持不变。Withu 不包含来源页的演示麦克风、自动演出或页面控制器。

|情绪／本地表情|Ball 状态|呈现|
|---|---|---|
|平静|idle|暖橙／暖黄色流动、呼吸光晕、双眼自然眨眼|
|问候|wink|左右各50%随机单眼上弯弧线、另一眼胶囊形；保持当前状态|
|开心|happy|弧形笑眼、轻晃、彩色光点|
|困倦|sleepy|闭眼点头、惊醒后抖头|
|轻快／唱歌|music|节奏摇摆和音符；只是无声表情动画|
|疑惑／好奇|curious|视线跟随指针、反向歪头|
|生气|angry|红粉色流动、斜眼和生气符号|
|委屈／低落|sad|灰色材质、委屈表情|
|思考|waiting|视线轻扫、等待轻晃|
|倾听|listening|专注双眼和点头，随实际麦克风电平变化|
|回应|speaking|三根白色电平条右→中→左平滑循环，随实际播放音量变化|
|服务出错|sad|使用原产物委屈表情，不新增 error 状态|

|Withu 运行状态|Ball 状态|
|---|---|
|待机 idle|本地选择的表情，默认 idle；闲置时可打瞌睡|
|倾听 listening|listening|
|思考 thinking|waiting|
|正在播放 speaking|speaking|
|连接中 reconnecting|waiting|
|故障 degraded|sad|
|被打断 interrupted|angry / waiting 各50%，2.5秒后恢复运行状态|
|通话结束 ended|happy＋一次彩带，不自旋|

通话运行状态驱动基础表情，打断、回复播放结束和用户交互按下方最新规则短暂覆盖；新的播放或故障优先。表情菜单只是本地预览，不调用模型、不写长期记忆，也不表示模型已识别用户心理状态。自动情绪识别和模型情绪编排不在本次替换中实现。

主舞台顶部居中、拖拽、右键菜单及普通活动面板保留。通话时球体移入语音图标下方的毛玻璃工具栏，挂断后回到主舞台。点击、双击和拖拽交互统一进入好奇，不再调用旧球自旋。所有位置使用同一渲染组件；文字生成映射 waiting，真实通话映射听/想/说状态。材质 WebGL 不可用时采用 Canvas 圆形渐变与同一表情层，卸载时释放 GPU/ResizeObserver/动画帧。没有新增 Avatar 模型、资产下载或摄像头权限。

来源文件 SHA256：E9CB8366132AD7DC2F6D0F989F79E5E0320C7717281B9528CBAD880E00CF2E31。

验证：Vite 生产构建、61 contracts、19 presence、realtime client 检查通过；Electron 实际材质绘制/六表情/面板挂载与切页卸载截图在 output/p3/orb-check/development。合成麦克风实时通话回归 output/p3/realtime-desktop/run-VRejFR/results.json 通过。本轮修改源码和开发构建，原 alpha16 包尚未更新。

## 最新行为（用户调整）

只保留来源的11个状态。回复实际音频播放结束后 music 3.5秒，再恢复倾听；不是文字生成完成就唱歌。单击、双击、拖拽结束后 curious，最后一次交互后4秒没有第二次交互则 idle/happy/wink 各1/3。只有 idle 持续20秒没有交互或状态切换才 sleepy；指针移动只驱动目光，不重置闲置计时。打断在有回复或播放时触发 angry/waiting 各1/2，不把首次开始说话当打断。新的播放和错误会结束临时表情。

语音通话不使用活动侧栏，通话期间按钮、菜单、Ctrl+.和自动展开均禁用侧栏。图标下的毛玻璃工具栏仅包含顶部居中时长、球体和挂断按钮；时长从服务 ready 后计起。ASR 编辑文字和助手流式回复显示在消息舞台；球体自身音量动画继续使用真实输入/播放音量。挂断按钮采用横放听筒 Phone 图标。随机/计时/清理负例、实际Electron绘制、实时通话回归均有专门检查。源码与开发构建已更新，alpha16包未更新。

本轮通话工具栏验证：Vite 构建、realtime-client、orb-behavior、19 presence 检查通过。实际 Electron 回归验证语音图标下方位置、顶部计时、侧栏已打开时启动通话会收起、按钮/菜单/Ctrl+.锁定、主消息区转写和回复、挂断恢复及重载清理。证据：E:\Orbit\demobuddy\output\p3\realtime-desktop\run-iJPU09\results.json；截图 call-toolbar.png。该回归使用合成麦克风及本地协议服务，不代表真实云服务/物理设备验收。未重新打包。

最新调整：通话卡片168×224px，增强渐变半透明、36px背景模糊、边缘高光及内阴影；红色挂断按钮使用毛玻璃质感，居中放在球体下方。挂断解锁侧栏，活动记录本次通话时长；通过公共 view.callHistory 严格字段持久化，重新加载仍保留，重复结束不重复记录。回归证据 E:\Orbit\demobuddy\output\p3\realtime-desktop\run-1O9Rfp\results.json（该截图为加宽前144px版本）。Rust server构建、61契约、实时客户端与Electron挂断/历史/重载回归通过。

最新布局与交互：菜单栏48px、常驻导航68px；消息内容及输入栏统一最大728px。通话卡片184×264px，通话和主舞台球体均88×88px。主舞台球体位置固定，拖拽只保留原材质弹性偏移与松开回弹；单击眨眼、双击弹跳，右键等同双击且删除表情菜单。交互后的curious及随机恢复规则保持。球体下方圆形渐变遮罩的14px backdrop blur对靠近文字产生磨砂模糊。

通话卡片最新宽度208px，高度264px。活动页消息点击直接滚动到对应消息并闪动蓝色阴影两次，侧栏保持打开；设置图标上移8px。实际Electron消息定位/阴影动画/导航尺寸回归 output/p3/realtime-desktop/run-lmYhjW/results.json，球体右键/固定位置弹性拖拽/实际模糊/材质/卸载回归 output/p3/orb-check/layout/orb-results.json 通过。

最新尺寸：主舞台标题栏44px，标题文字额外上移3px；新建对话采用MessageCirclePlus图标。通话卡片高264px、宽156.75px，严格高宽16:9.5；挂断按钮下移8px。
