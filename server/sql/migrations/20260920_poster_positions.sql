-- 张贴位置管理（poster_positions）
--
-- 背景：
--   管理端 `Poster/PositionManage.vue` 一直存在，但 `admin/src/api/poster.js` 中
--   getPositions / createPosition / updatePosition / deletePosition 四处全部错误地打在
--   `/poster`（海报申请接口）上——读列表读到的是海报申请，写操作更会误增改删海报申请数据。
--   后端此前完全没有张贴位置的数据表 / 控制器 / 路由，整块能力属于「从未实现」。
--   本迁移补上该能力的数据底座，字段对齐前端页面已在使用的一组语义：
--   位置名称、所在楼栋、楼层、最大海报数、当前海报数、状态（启用/停用）、描述。
--
-- 幂等性：
--   使用 `CREATE TABLE IF NOT EXISTS`，可重复执行不报错（MySQL 8 原生支持该语法）。
--   注意：MySQL 8 **不支持** `ADD COLUMN IF NOT EXISTS`（列级幂等需走 information_schema
--   探测 + PREPARE，参见 20260920_room_geo.sql）。本表为全新表，`CREATE TABLE IF NOT EXISTS`
--   已足够；若日后需要加列，请单独写列级幂等迁移。
--
-- 删除策略说明：
--   `posters` 表没有「已删除」语义（其 status 枚举为 pending/approved/rejected/cleaned/
--   expired/violation），按仓库既有约定，位置删除采用**物理删除**，与 posters 保持一致。
--
-- 兼容性：仅新增一张独立表，不改动任何既有表结构，也不写入业务数据，可安全蓝绿部署。

CREATE TABLE IF NOT EXISTS poster_positions (
  id INT AUTO_INCREMENT PRIMARY KEY COMMENT '位置ID',
  name VARCHAR(100) NOT NULL COMMENT '张贴位置名称',
  building_id INT DEFAULT NULL COMMENT '所属楼栋ID（管理员数据域隔离用；NULL 表示未指定楼栋）',
  floor INT NOT NULL DEFAULT 1 COMMENT '所在楼层',
  max_posters INT NOT NULL DEFAULT 4 COMMENT '该位置最多可同时张贴的海报数',
  current_posters INT NOT NULL DEFAULT 0 COMMENT '当前已张贴海报数',
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active' COMMENT '启用/停用',
  description VARCHAR(500) NOT NULL DEFAULT '' COMMENT '位置描述',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL,
  INDEX idx_poster_positions_building (building_id),
  INDEX idx_poster_positions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='海报张贴位置';
