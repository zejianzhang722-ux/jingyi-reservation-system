CREATE TABLE IF NOT EXISTS admin_notifications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  building_id INT NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  data JSON NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  is_read TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_notice_dedupe (admin_id, dedupe_key),
  KEY idx_admin_notice_unread (admin_id, is_read, created_at),
  CONSTRAINT fk_admin_notice_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT fk_admin_notice_building FOREIGN KEY (building_id) REFERENCES buildings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
