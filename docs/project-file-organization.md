# 项目文件组织约定

本项目相关内容统一保存在 `jingyi-reservation-system` 内：

- `admin/`：网页管理后台
- `server/`：后端服务
- `miniapp/`：微信小程序
- `docs/product-design/`：产品方案、PRD、架构与升级说明
- `docs/reference/`：品牌素材和历史界面截图
- `docs/legacy-root/`：从旧工作区归档的项目文档
- `.worktrees/`：其他 Agent 或并行开发任务的 Git 工作区
- `.runlogs/`：测试、验收和运行日志
- `.artifacts/`：测试上传、预览二维码和构建验证产物
- `.trae/`、`.workbuddy/`、`.codex-tools/`：其他 Agent 留下的项目规格、记忆与辅助脚本
- `.cache/`、`.tools/`：本项目本地缓存和开发工具

其中 `.worktrees/`、`.runlogs/`、`.artifacts/`、Agent 目录和本地缓存均为本机开发资料，不纳入正式版本提交。书院住宿、巡查、活动和功能房原始业务档案仍保存在上级目录，避免与软件工程文件混放或误提交。
