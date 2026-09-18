-- 预约审核「乐观锁 + 批注轨迹」迁移（架构设计 R-02 / 任务 T05）
--
-- 背景：
--   1) 审核链路当前无版本号，仅靠 `UPDATE ... WHERE id=? AND status=?` 做条件更新。
--      蓝绿过渡期需要可识别的并发冲突（AUDIT_VERSION_CONFLICT）。
--   2) 一审 / 二审（pending / counselor_pending）的多级批注目前只能落 `reject_reason` 单字段，
--      需要独立轨迹表承载 approve / reject / remark / transfer 的多级留痕，供 R-07 用户端展示。
--
-- 幂等性：
--   - 建表使用 `CREATE TABLE IF NOT EXISTS`，可重复执行。
--   - `reservations.version` 的加列在 MySQL 8 **不支持** `ADD COLUMN IF NOT EXISTS`，
--     故使用 `information_schema` 探测 + 预处理语句的幂等写法（存在则执行 `SELECT 1` 空操作）。
--     脚本 `scripts/apply-reservation-audit-migration.js` 用同样的探测方式，二者可任选其一执行。
--
-- 兼容性：只新增列 / 新增表，不改动既有列语义；`version` 默认 1，历史行自动回填。
-- 本迁移**不写入任何业务数据**。
--
-- 关于外键：本表刻意**不建外键**——
--   actor_id 可能为系统账号或历史已删除管理员，且蓝绿部署期间新旧代码并存，
--   避免因级联删除/约束校验带来非预期副作用；一致性由应用层与审计链（auditTrailService）共同保证。
--
-- 执行前检查：
--   SELECT COUNT(*) FROM reservations;  -- 应 >= 0，表须已存在
--   SELECT COLUMN_NAME FROM information_schema.columns
--     WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'version';

CREATE TABLE IF NOT EXISTS reservation_audit_trail (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL COMMENT '预约 id（reservations.id）',
  stage ENUM('first', 'counselor') NOT NULL DEFAULT 'first' COMMENT '审核阶段：first=一审(admin)，counselor=二审(辅导员)',
  actor_id INT DEFAULT NULL COMMENT '操作人 id（管理员 admins.id；系统动作可为空）',
  actor_role VARCHAR(32) DEFAULT '' COMMENT '操作人角色快照（admin/super_admin/counselor/system）',
  action ENUM('approve', 'reject', 'remark', 'transfer') NOT NULL COMMENT '动作：通过/驳回/批注/转移',
  remark VARCHAR(500) DEFAULT '' COMMENT '批注 / 驳回原因（用户可见）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
  KEY idx_reservation_audit_trail_reservation (reservation_id),
  KEY idx_reservation_audit_trail_reservation_created (reservation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预约审核批注轨迹（R-02）';

-- ── 幂等加列：reservations.version ────────────────────────────────────────────
SET @res_version_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'reservations' AND column_name = 'version'
);
SET @res_version_ddl := IF(
  @res_version_exists = 0,
  'ALTER TABLE reservations ADD COLUMN version INT NOT NULL DEFAULT 1 COMMENT ''审核乐观锁版本号（R-02）''',
  'SELECT 1'
);
PREPARE stmt_res_version FROM @res_version_ddl;
EXECUTE stmt_res_version;
DEALLOCATE PREPARE stmt_res_version;
