-- 团队预约（组团预约）功能补全迁移
--
-- 背景：schema.sql 中 reservation_groups / reservation_group_members 两张表早已建立，
-- 但后端长期没有任何写入路径，小程序 pages/group-reserve 调用 /groups 系列接口会 404。
-- 本迁移补齐该业务所需的字段与约束。
--
-- 执行前检查（重要）：
--   1) reservation_groups / reservation_group_members 目前应为空表（历史上从未写入）。
--      若已有数据，先执行下面的去重检查，处理完再继续：
--        SELECT group_id, user_id, COUNT(*) c
--        FROM reservation_group_members GROUP BY group_id, user_id HAVING c > 1;
--      存在重复行时先 DELETE 掉多余记录，否则步骤 3 的唯一键会创建失败。
--   2) reservation_groups.max_members 默认值 4，与小程序端默认值保持一致。
--
-- 幂等说明：MySQL 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报错，属预期行为。
-- 可用 information_schema 先行判断（见 scripts 目录的迁移预检惯例）。

-- 步骤 0：团队状态需要覆盖辅导员审核态。
-- 原 ENUM 只有 pending/approved/rejected/cancelled，但房间开启 need_counselor_audit 时
-- 主预约会进入 counselor_pending，团队状态必须能表达该中间态，否则写入会被严格模式拒绝。
ALTER TABLE reservation_groups
  MODIFY status ENUM('pending', 'counselor_pending', 'approved', 'rejected', 'cancelled')
    DEFAULT 'pending' COMMENT '与关联主预约 reservations.status 保持一致';

-- 步骤 1：团队元信息补全。
-- 刻意不写 AFTER 子句：同一条 ALTER 中让新列的 AFTER 指向本语句刚加的列，
-- 在部分 MySQL 版本会报 «Unknown column»，而列顺序对本功能没有影响。
ALTER TABLE reservation_groups
  ADD COLUMN max_members INT NOT NULL DEFAULT 4 COMMENT '团队人数上限（含创建者）',
  ADD COLUMN reservation_id INT DEFAULT NULL COMMENT '关联的主预约，承载占槽/审批/签到/爽约',
  ADD COLUMN reject_reason VARCHAR(500) DEFAULT '',
  ADD COLUMN audited_by INT DEFAULT NULL,
  ADD COLUMN audited_at DATETIME DEFAULT NULL,
  ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- 步骤 2：索引。团队预约按房间+日期查询最频繁，其次按状态走管理端待审列表。
ALTER TABLE reservation_groups
  ADD INDEX idx_groups_room_date (room_id, date),
  ADD INDEX idx_groups_status (status),
  ADD INDEX idx_groups_creator (created_by),
  ADD INDEX idx_groups_reservation (reservation_id);

-- 步骤 3：关联主预约。团队解散/取消时主预约会释放槽位，此处用 SET NULL 让团队记录本身保留可追溯。
ALTER TABLE reservation_groups
  ADD CONSTRAINT fk_groups_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;

-- 步骤 4：防止同一用户重复加入同一团队（并发点「加入」时会产生脏数据）。
ALTER TABLE reservation_group_members
  ADD UNIQUE KEY uk_group_user (group_id, user_id);

-- 步骤 5：按团队查成员的索引。
ALTER TABLE reservation_group_members
  ADD INDEX idx_group_members_user (user_id);
