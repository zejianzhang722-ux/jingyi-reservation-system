-- 管理端「临时授权」+「岗位交接」迁移（架构设计 R-06）
--
-- 背景：换届（导生会/辅导员轮换）时需要
--   1) 带有效期的临时授权：把某个能力（审核/签到/数据导出/规则配置）临时授予某管理员，到期自动失效；
--   2) 岗位交接：把岗位从离任人事务化地交给新任人，并撤销离任人的旧会话。
--
-- 幂等性：全部使用 CREATE TABLE IF NOT EXISTS，可重复执行。
--
-- 关于 admins 表：经核对 server/sql/schema.sql（第 314-328 行），admins 已存在
--   status ENUM('active','disabled')，足以支撑「结束旧任职（status='disabled'）/ 启用新任职（status='active'）」，
--   因此本迁移**不新增任何列**，避免无意义的 ALTER。
--   若未来某套环境确实缺少 status 列，请在此文件末尾追加幂等 ALTER（用 information_schema 先判断）。
--
-- 执行前检查：
--   SELECT COUNT(*) FROM admins;  -- 应 > 0
--   确认 admins 表存在 status 列：
--     SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.columns
--     WHERE table_schema = DATABASE() AND table_name = 'admins' AND column_name = 'status';
--   迁移本身不写入任何业务数据。

CREATE TABLE IF NOT EXISTS admin_capability_grants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL COMMENT '被授权的管理员 id',
  capability ENUM('audit', 'checkin', 'data_export', 'rule_config') NOT NULL COMMENT '能力项',
  granted_by INT DEFAULT NULL COMMENT '执行授权的管理员 id',
  valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权生效时间',
  valid_to DATETIME NOT NULL COMMENT '授权失效时间（过期即自动失效，不做后台定时任务）',
  status ENUM('active', 'expired', 'revoked') NOT NULL DEFAULT 'active' COMMENT '授权状态',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_capability_expiry (capability, valid_to),
  KEY idx_admin_capability_admin (admin_id, status),
  CONSTRAINT fk_admin_cap_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_cap_granted_by FOREIGN KEY (granted_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员临时能力授权（带有效期）';

CREATE TABLE IF NOT EXISTS admin_handover (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL COMMENT '交接标的：被交接的管理员账号 id（等于离任方账号）',
  from_user INT NOT NULL COMMENT '离任方（当前持有人）管理员 id',
  to_user INT NOT NULL COMMENT '新任持有人管理员 id',
  status ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending' COMMENT '交接状态',
  initiated_by INT DEFAULT NULL COMMENT '发起交接的管理员 id',
  accepted_at DATETIME DEFAULT NULL COMMENT '接受交接时间',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin_handover_status (status, created_at),
  KEY idx_admin_handover_from (from_user),
  KEY idx_admin_handover_to (to_user),
  CONSTRAINT fk_admin_handover_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_handover_from FOREIGN KEY (from_user) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_handover_to FOREIGN KEY (to_user) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理员岗位交接';
