@echo off
chcp 65001 >nul
echo ============================================
echo   敬一书院功能房预约管理系统 - 一键启动
echo ============================================
echo.

echo [1/4] 检查 Node.js 环境...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 Node.js v18+
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js 已安装

echo.
echo [2/4] 安装后端依赖...
cd /d "%~dp0server"
call npm install
if %errorlevel% neq 0 (
    echo ❌ 后端依赖安装失败
    pause
    exit /b 1
)
echo ✅ 后端依赖安装完成

echo.
echo [3/4] 安装管理后台依赖...
cd /d "%~dp0admin"
call npm install
if %errorlevel% neq 0 (
    echo ❌ 管理后台依赖安装失败
    pause
    exit /b 1
)
echo ✅ 管理后台依赖安装完成

echo.
echo [4/4] 启动服务...
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   后端服务启动中... (端口: 3000)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
start "敬一书院-后端服务" cmd /k "cd /d "%~dp0server" && npm run dev"

timeout /t 3 /nobreak >nul

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   管理后台启动中... (端口: 5173)
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
start "敬一书院-管理后台" cmd /k "cd /d "%~dp0admin" && npm run dev"

echo.
echo ============================================
echo   🎉 启动完成！
echo ============================================
echo.
echo   后端 API:    http://localhost:3000/api/v1
echo   管理后台:    http://localhost:5173
echo.
echo   管理员账号:  admin / admin123
echo   超管账号:    superadmin / super123
echo.
echo   ⚠️  首次使用请先初始化数据库:
echo       mysql -u root -p < server\sql\schema.sql
echo       mysql -u root -p < server\sql\seed.sql
echo.
echo   微信小程序请使用微信开发者工具打开 miniapp 目录
echo ============================================
echo.
pause
