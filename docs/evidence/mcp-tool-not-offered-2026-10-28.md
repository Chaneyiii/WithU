# 第 5 项失败取证：MCP 工具根本没被提供给模型（2026-10-28）

## 1. 结论

用户的第 5 项测试是在**没有 `WITHU_MCP_COMMAND` 环境变量**的情况下启动的打包版。
`main.cjs::startMcp` 第一行就是 `if(!process.env.WITHU_MCP_COMMAND)return;`，
所以 MCP 服务器没启动、工具没注册、模型手里只有 13 个本地工具，自然无法调用
`annotate`，于是它只能闲聊（截图里「在呢。今天过得怎么样?」）。

**不是模型不听话，是它根本没有那把工具。**

## 2. 现场证据（用户当时那次运行）

| 检查 | 结果 |
|---|---|
| 运行中的 `Withu.exe` | 4 个进程，均启动于 23:58:02，命令行是普通启动（无额外参数） |
| 是否存在 MCP 子进程 | **没有**。全机扫描 `Win32_Process` 中命令行含 `mcp-app-server` 的进程，只命中我自己的查询脚本 |
| 当前默认模型 | `provider-96155ea0…` / `deepseek-flash`（真实模型），另有 `fixture` provider 指向 `127.0.0.1:48171` 但非默认 |
| MCP 夹具文件访问时间 | 23:58:19 —— 这是**我自己**当时 grep 该文件造成的，不是 MCP 进程读取 |

MCP 客户端是长驻子进程（stdio 服务器），应用活着它就该活着。没有子进程 = 没启动。

## 3. A/B 实测（关键证据）

`output/probe/mcp-flag-ab.mjs`：同一套源码、同一个假模型，只差环境变量，看模型请求里的工具目录。

| 组 | 启动方式 | 工具数 | MCP 工具 |
|---|---|---|---|
| A | 不带 `WITHU_MCP_*`（等于从资源管理器双击） | **13** | **[]** |
| B | 带 `WITHU_MCP_COMMAND=node` / `WITHU_MCP_ARGS=…mcp-app-server.mjs` / `WITHU_MCP_SERVER=local` | **14** | **["mcp__local__annotate"]** |

输出原文：

```
[A 无 WITHU_MCP_*（等于从资源管理器启动）] tools=13 mcp=[]
[B 带 WITHU_MCP_*（run-with-mcp.cmd 的方式）] tools=14 mcp=["mcp__local__annotate"]
A 有 MCP 工具: false | B 有 MCP 工具: true
```

这就是「第 5 项不行」的直接原因，可复现、与模型无关。

## 4. 修复与改进

1. **`checks/run-with-mcp.cmd`**（新增）：一键用**打包版**+MCP 夹具启动，
   启动后自动检查 MCP 子进程是否真的起来（打印 `OK MCP 服务器运行中：Withu.exe#PID` 或 `WARN`）。
   用打包版的好处：图标仍是 Withu 标（开发态 `electron.exe` 显示 Electron 标是正常的）。
2. **夹具工具描述**改为 `Save a short local note (本地注记) on this device`，
   让中文指令「记一条注记」更容易映射到 `annotate`。
3. **验收对照表第 5 项**改写：给脚本、给口令、给「模型反问时补一句」的兜底；
   同时把 5b/5c/5d（写类确认、取消、允许）标为**不适用**——该夹具工具是只读型，
   写类确认已由第 1 项的审批卡覆盖。
4. 第 1–4 项按用户实测结果勾选通过；图标项注明「只有打包版是 Withu 标」。

## 5. 还没排除的

- 5a 里模型是否**稳定**调用 `annotate`：工具已提供（B 组已证），但真实模型的调用意愿
  只能再点一次确认。若它反问，按对照表补一句「直接调用 annotate，文本是 上课」。
- 如果 `run-with-mcp.cmd` 报 `WARN`，说明 MCP 进程起不来（例如 node 不在 PATH、
  或 `ELECTRON_RUN_AS_NODE` 被拦），那是另一类问题，需要看它打印的 PID 与窗口报错。
