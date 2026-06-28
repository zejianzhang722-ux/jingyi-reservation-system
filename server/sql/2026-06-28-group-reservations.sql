-- 组团预约功能所需数据表。
-- 在正式数据库执行前，请先备份数据库，并确认表名前缀与当前部署一致。

CREATE TABLE IF NOT EXISTS reservation_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_id BIGINT UNSIGNED NOT NULL,
  creator_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(80) NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_members INT NOT NULL DEFAULT 4,
  description VARCHAR(200) DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_group_room_time (room_id, date, start_time, end_time),
  KEY idx_group_creator (creator_id),
  KEY idx_group_status (status, date)
);

CREATE TABLE IF NOT EXISTS group_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_group_member (group_id, user_id),
  KEY idx_group_member_user (user_id)
);
