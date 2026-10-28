@echo off
chcp 65001 >nul
setlocal EnableExtensions
rem ============================================================
rem  真机验收第 5 项（MCP 端到端）用这个脚本启动。
rem  用【打包版】而不是开发态：图标是 Withu 标，验的也是你手上这个包。
rem  为什么必须用它：MCP 只在设置了 WITHU_MCP_COMMAND 时才启动，
rem  从资源管理器双击 Withu.exe 是没有这个环境变量的（实测：13 个工具，0 个 MCP）。
rem  用法：先完全退出 Withu（含托盘），再双击本文件。
rem ============================================================
set "ROOT=%~dp0.."
set "APP=%ROOT%\output\p1\windows\Withu-win32-x64\Withu.exe"
set "FIXTURE=%ROOT%\checks\fixtures\mcp-app-server.mjs"

if not exist "%APP%" (
  echo [FAIL] 找不到打包版：%APP%
  pause & exit /b 1
)
if not exist "%FIXTURE%" (
  echo [FAIL] 找不到 MCP 夹具：%FIXTURE%
  pause & exit /b 1
)
tasklist /fi "imagename eq Withu.exe" 2>nul | find /i "Withu.exe" >nul && (
  echo [FAIL] Withu 正在运行。先完全退出（右击托盘图标退出），再跑本脚本。
  pause & exit /b 1
)

set "WITHU_MCP_COMMAND=node"
set "WITHU_MCP_ARGS=%FIXTURE%"
set "WITHU_MCP_SERVER=local"

echo 启动打包版，并挂上本地 MCP 服务器…
echo   command = %WITHU_MCP_COMMAND%
echo   args    = %WITHU_MCP_ARGS%
start "" "%APP%"

echo 等 8 秒，检查 MCP 子进程是否真的起来了…
timeout /t 8 /nobreak >nul
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mcp-app-server.mjs*' -and $_.Name -ne 'powershell.exe' }; if ($p) { 'OK   MCP 服务器运行中：' + (($p | ForEach-Object { $_.Name + '#' + $_.ProcessId }) -join ',') } else { 'WARN 没有找到 MCP 子进程 —— 第 5 项会失败，把这一步的截图发我' }"

echo.
echo 接下来在应用里说：「用本地工具记一条注记：上课」
echo   预期：回一条 annotated:上课，并且消息下方出现一块应用界面。
echo   如果模型只是反问「要不要记」，补一句：「直接调用 annotate，文本是 上课」。
echo.
echo 注意：请确认设置里默认模型是【你自己的真实模型】，不是 gui-test 的假模型。
echo.
pause
