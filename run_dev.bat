@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 网盘任务管家 - 开发模式
echo ============================================
call npm run tauri dev
echo.
echo 应用已退出,按任意键关闭...
pause >nul
