@echo off
chcp 65001 >nul
setlocal

set PORT=4173
if not "%1"=="" set PORT=%1

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo 正在停止进程 %%p ...
  taskkill /f /pid %%p >nul 2>nul
)

echo 已停止 %PORT% 端口上的服务。
pause >nul
