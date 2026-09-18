-- 补签「申请 → 审核 → 留痕」迁移（架构设计 R-08 / 任务 T04）
--
-- 背景：
--   现有 `checkinController.manualCheckin` 是「管理员直接写 checkins(checkin_type='admin_manual')」，
--   无申请人 / 审核人 / 原因 / 工单留痕。R-08 引入补签工单表：
--     宿生端（或前台）提交补签申请 -> 另一位管理员审核 -> 审核通过后才事务化写入 checkins。
--
-- 幂等性：
--   - 建表使用 `CREATE TABLE IF NOT EXISTS`，可重复执行。
--   - `checkins.supplement_request_id`、`supplement_requests.review_remark` 的加列在 MySQL 8 **不支持**
--     `ADD COLUMN IF NOT EXISTS`，故使用 `information_schema` 探测 + 预处理语句的幂等写法。
--     脚本 `scripts/apply-supplement-migration.js` 用同样的探测方式，二者可任选其一执行。
--
-- 兼容性：只新增表 / 新增可空列，不改动既有列语义；`supplement_request_id` 默认 NULL，
--         既有的直接写入路径（manualCheckin）不受影响，蓝绿过渡安全。
-- 本迁移**不写入任何业务数据**。
--
-- 关于外键：本表刻意**不建外键**——
--   applicant_id / reviewer_id 可能为历史已删除管理员，蓝绿期新旧代码并存，
--   避免级联删除/约束校验带来非预期副作用；一致性由应用层与审计链共同保证。
--
-- 执行前检查：
--   SELECT COUNT(*) FROM reservations;  -- 表须已存在
--   SELECT COUNT(*) FROM checkins;      -- 表须已存在

CREATE TABLE IF NOT EXISTS supplement_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL COMMENT '预约 id（reservations.id）',
  applicant_id INT NOT NULL COMMENT '申请人 id（管理员 admins.id）',
  type ENUM('signin', 'signout') NOT NULL COMMENT '补签类型：补签到 / 补签退',
  reason VARCHAR(255) NOT NULL COMMENT '补签原因（必填，用户可见）',
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending' COMMENT '工单状态',
  reviewer_id INT DEFAULT NULL COMMENT '审核人 id（管理员 admins.id）',
  reviewed_at DATETIME DEFAULT NULL COMMENT '审核时间',
  review_remark VARCHAR(255) DEFAULT NULL COMMENT '审核意见（approve/reject 均可填，无意见为 NULL）',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '申请时间',
  KEY idx_supplement_reservation (reservation_id),
  KEY idx_supplement_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补签工单（申请-审核-留痕，R-08）';

-- ── 幂等加列：checkins.supplement_request_id ─────────────────────────────────
SET @checkin_supplement_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'checkins' AND column_name = 'supplement_request_id'
);
SET @checkin_supplement_ddl := IF(
  @checkin_supplement_exists = 0,
  'ALTER TABLE checkins ADD COLUMN supplement_request_id INT DEFAULT NULL COMMENT ''关联补签工单 id（R-08）''',
  'SELECT 1'
);
PREPARE stmt_checkin_supplement FROM @checkin_supplement_ddl;
EXECUTE stmt_checkin_supplement;
DEALLOCATE PREPARE stmt_checkin_supplement;

-- ── 幂等加列：supplement_requests.review_remark ──────────────────────────────
-- 供已先行建表（旧版无该列）的环境补齐；全新环境由上面的建表语句直接带上该列。
SET @supplement_review_remark_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'supplement_requests' AND column_name = 'review_remark'
);
SET @supplement_review_remark_ddl := IF(
  @supplement_review_remark_exists = 0,
  'ALTER TABLE supplement_requests ADD COLUMN review_remark VARCHAR(255) DEFAULT NULL COMMENT ''审核意见（approve/reject 均可填，无意见为 NULL）''',
  'SELECT 1'
);
PREPARE stmt_supplement_review_remark FROM @supplement_review_remark_ddl;
EXECUTE stmt_supplement_review_remark;
DEALLOCATE PREPARE stmt_supplement_review_remark;
