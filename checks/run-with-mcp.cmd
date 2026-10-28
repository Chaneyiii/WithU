@echo off
chcp 65001 >nul 2>nul
setlocal EnableExtensions
rem ============================================================
rem  Manual acceptance item 5 (MCP end to end).
rem  Quit Withu completely first (tray icon -> Quit).
rem  MCP only starts when WITHU_MCP_COMMAND is set; double-clicking
rem  Withu.exe from Explorer does not set it (measured: 13 tools, 0 MCP).
rem ============================================================
set "SYS=%SystemRoot%\System32"
set "ROOT=%~dp0.."
set "APP=%ROOT%\output\p1\windows\Withu-win32-x64\Withu.exe"
set "FIXTURE=%ROOT%\checks\fixtures\mcp-app-server.mjs"
set "MARK=%ROOT%\output\probe\mcp-alive.txt"

if not exist "%APP%" goto noapp
if not exist "%FIXTURE%" goto nofix
"%SYS%\tasklist.exe" /fi "imagename eq Withu.exe" 2>nul | "%SYS%\find.exe" /i "Withu.exe" >nul
if not errorlevel 1 goto running

if not exist "%ROOT%\output\probe" mkdir "%ROOT%\output\probe"
if exist "%MARK%" del "%MARK%" >nul 2>nul

set "WITHU_MCP_COMMAND=node"
set "WITHU_MCP_ARGS=%FIXTURE%"
set "WITHU_MCP_SERVER=local"
set "WITHU_MCP_MARK=%MARK%"

echo Starting packaged Withu with the local MCP server ...
echo   exe  = %APP%
echo   args = %FIXTURE%
echo.
start "" "%APP%"

echo Waiting 8s, then checking whether the MCP server came up ...
"%SYS%\ping.exe" -n 9 127.0.0.1 >nul
if not exist "%MARK%" goto nomcp
set /p MPID=<"%MARK%"
echo [OK] MCP server is running, pid=%MPID%
goto instructions

:nomcp
echo [WARN] No MCP server detected - item 5 will fail.
echo        Either node is missing, or the MCP child failed to start.
echo        Please screenshot this window and send it to me.

:instructions
echo.
echo Say this in the app:  用本地工具记一条注记：上课
echo Expect: a reply "annotated:上课" plus an app panel under the message.
echo If the model asks back, add: 直接调用 annotate，文本是 上课
echo.
echo Also make sure the default model is your own real provider,
echo not the gui-test fixture.
echo.
pause
exit /b 0

:noapp
echo [FAIL] Missing: %APP%
pause
exit /b 1

:nofix
echo [FAIL] Missing fixture: %FIXTURE%
pause
exit /b 1

:running
echo [FAIL] Withu is already running. Quit it completely (tray icon - Quit) and run this again.
pause
exit /b 1
