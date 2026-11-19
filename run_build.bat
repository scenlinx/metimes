@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [build] 构建 Tauri 生产包（Vite + Rust）...
call npm run tauri:build
if errorlevel 1 (
  echo.
  echo [build] 构建失败，请检查上方日志。
  pause
)
