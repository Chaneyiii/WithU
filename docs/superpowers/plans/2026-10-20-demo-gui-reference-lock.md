# Demo P1/P2 GUI 原始要求与引用

来源：用户于 2026-10-20 在当前对话补充的原 prompt。此文记录最新 GUI 依据；当前执行范围仍为 Phase 0 与 Phase 1，Phase 2 要求保留供后续实施。

## Phase 1：T02–T05

| 任务 | 用户要求 | 参考 |
|---|---|---|
| T02 图标 | 更新为视频展示的这一套；不得用 emoji、文字符号、CSS 绘图或临时手绘 SVG 代替 | [图标视频](https://cdn.collectui.com/amplify_video/2109709222371868672/vid/avc1/1920x1080/00HHPdmozwqU9WX_-optimized.mp4)、[_eugrl 案例页](https://collectui.com/designers/_eugrl) |
| T02 列表 | 所有显示/隐藏列表参考同一套，交互丝滑 | [CSS 列表案例](https://collectui.com/designs/css-ui-design-inspiration/c6e9a4d3-e029-467d-8db8-e35e5b5196bc)、[Menu 案例](https://collectui.com/designs/menu-ui-design-inspiration/67582462-f25b-4323-bb6a-2b6b14a8d036) |
| T02 侧栏 | 保留内容、名称、顺序和功能，只调整视觉状态 | [颜色案例一](https://cdn.collectui.com/media/HKOLZo8aUAAkYFf.avif)、[颜色案例二](https://cdn.collectui.com/media/HJu3rRnbsAAZOsK.avif)（沿用原计划） |
| T03 顶部栏 | 移除“文件”“编辑”等菜单文字；按参考改为聊天、动态、目标、灵感、资料、设置功能页标签，搜索保留现有操作 | 原计划 G02 / 顶部栏约束；用户本次重申 |
| T04 原子通知 | 放在主舞台左上角原会话标题位置，撤掉会话标题；所有通知统一进入胶囊；无通知保留收起态，点击展开，多条上下滚动切换 | [通知案例](https://collectui.com/designs/notification-ui-design-inspiration/59aeec1c-5198-4e63-9a85-105f32591f67) |
| T04 顶栏图标 | 新建会话移到右上角、紧挨语音通话图标左侧；左上和右上图标与 tooltip 按参考；移除生活支持按钮和生活事务常驻横条 | [Tooltip/Popover 案例](https://collectui.com/designs/tooltip-popover-ui-design-inspiration/30e894e1-f1dd-4b9a-8d14-0fbe9a940d97) |
| T05 新对话 | 仅首条消息发送前输入框居于主舞台中央；发送后回到底部原位置，其余交互维持原有行为 | [新对话案例](https://collectui.com/designs/ai-ui-design-inspiration/78051db2-518e-41b6-92e9-56943d115544) |

## Phase 2：T06–T08（本轮记录）

| 范围 | 用户要求 | 参考 |
|---|---|---|
| 事务列表 | 聊天事务卡片放活动面板“即将发生”列表；日历、提醒走原子通知 | [Menu 案例](https://collectui.com/designs/menu-ui-design-inspiration/67582462-f25b-4323-bb6a-2b6b14a8d036) |
| 记忆 | 确认与管理通知走原子胶囊；Settings 不展示记忆列表；Soul 对应 AGENTS.md，Memory 对应记忆文件，通过活动面板查看 | 用户明确说明 |
| MCP App | 保留消息内卡片，在现有 Intelligence UI 幕布中展示 | 用户明确说明 |
| 通话面板 | 将案例放在原活动面板中间的位置 | [通话案例](https://collectui.com/designs/ui-interaction-ui-design-inspiration/c0ee31dc-2570-4aee-9df3-5be89ce730f7) |
| 动态内容 | 布局按案例，内容依据真实能力与真实链接，不凭空生成能力 | [动态卡片](https://cdn.collectui.com/media/G83ERWGXQAA6AId.avif) |
| 日期选择 | 第一套用于选择日期 | [日期选择](https://collectui.com/designs/calendar-ui-design-inspiration/4df04cb9-9c9a-4be1-b4bc-80b811861cb4) |
| 动态日历 | 第二套用于动态页日历卡片，支持切换日期、详情、创建提醒及联动其他卡片 | [日历卡片](https://collectui.com/designs/calendar-ui-design-inspiration/c6df3600-2650-42c0-931a-a1671757c423) |
| 模型与 Effort | 替换原模型选择浮层；在 Effort 行上方添加模型选择列表 | [Range Slider](https://collectui.com/designs/range-slider-ui-design-inspiration/78d07ba6-585c-47c5-bbbe-a906cbb3f336) |
| Settings | 维持原有页面风格，主动性和通知配置按原计划归位；启用开关更新 | [Switch](https://collectui.com/designs/switch-button-ui-design-inspiration/8706c04a-cb38-4873-9037-3658160c07fc) |
| 无数据提示 | 放到合适的无数据位置 | [无数据](https://cdn.collectui.com/media/HKcTws5akAELch5.avif) |

## 正式版记录

[思考轨迹参考](https://collectui.com/designs/ai-ui-design-inspiration/c9a139ec-fa24-4ed6-8510-730d8eb47317) 属于 Cowork 正式版。Demo 只记录，不实现。

## 验收口径

用户原 prompt 的具体参考优先于此前概括。视频或截图只能作为视觉参考，不能证明获得了原图标的可复用矢量资源；图标来源与获取情况必须记录，缺失资源不得以自行描画或另一个图标库冒充完成。界面行为、自动化检查和用户视觉验收分别记录。
