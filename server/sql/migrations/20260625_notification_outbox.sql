-- 第六阶段：通知幂等与事务Outbox。
-- 生产环境应优先执行 scripts/apply-notification-outbox-migration.js，
-- 该脚本会检查现有结构并可重复执行。

ALTER TABLE notifications
  ADD COLUMN dedupe_key VARCHAR(191) DEFAULT NULL AFTER data,
  ADD UNIQUE KEY uk_notification_user_dedupe (user_id, dedupe_key);

CREATE TABLE notification_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(191) NOT NULL,
  notification_id INT DEFAULT NULL,
  user_id INT DEFAULT NULL,
  channel ENUM('websocket', 'wechat') NOT NULL,
  event_name VARCHAR(100) DEFAULT NULL,
  payload JSON NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'failed', 'dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 8,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at DATETIME DEFAULT NULL,
  locked_by VARCHAR(100) DEFAULT NULL,
  last_error VARCHAR(1000) DEFAULT NULL,
  sent_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_notification_outbox_event (event_key),
  INDEX idx_notification_outbox_claim (status, available_at, id),
  INDEX idx_notification_outbox_notification (notification_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
