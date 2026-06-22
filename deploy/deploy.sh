#!/bin/bash
set -e

echo "=== 敬一书院预约系统部署脚本 ==="

PROJECT_DIR="/var/www/jingyi-reservation"
LOG_DIR="/var/log/jingyi"

mkdir -p $LOG_DIR

echo "[1/6] 拉取最新代码..."
cd $PROJECT_DIR
git pull origin main

echo "[2/6] 安装服务端依赖..."
cd $PROJECT_DIR/server
npm install --production

echo "[3/6] 构建管理后台..."
cd $PROJECT_DIR/admin
npm install
npm run build

echo "[4/6] 检查环境变量..."
if [ ! -f "$PROJECT_DIR/server/.env" ]; then
  echo "警告: .env 文件不存在，请从 .env.example 复制并配置"
  exit 1
fi

echo "[5/6] 重启服务..."
cd $PROJECT_DIR
pm2 reload deploy/ecosystem.config.js

echo "[6/6] 验证服务..."
sleep 3
if curl -s http://localhost:3000/api/v1/room > /dev/null 2>&1; then
  echo "✅ 服务启动成功"
else
  echo "❌ 服务启动失败，请检查日志"
  pm2 logs jingyi-api --lines 50
  exit 1
fi

echo "=== 部署完成 ==="
