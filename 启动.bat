@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js，请先安装 Node 22 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

node start-public.js %*

echo.
echo 服务已停止。按任意键关闭窗口。
pause >nul
