@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [build] 构建 Tauri 生产包（Vite + Rust）...
rem 打包时 Tauri 会从 GitHub 下载 NSIS/WiX 工具，国内直连易超时，这里默认走加速镜像
rem 如需更换镜像或使用本地代理，可在命令行预先设置该环境变量
if not defined TAURI_BUNDLER_TOOLS_GITHUB_MIRROR set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://ghfast.top/https://github.com"
call npm run tauri:build
if errorlevel 1 (
  echo.
  echo [build] 构建失败，请检查上方日志。
  pause
)
