-- Apply to the existing MySQL database before enabling the new role in production.
ALTER TABLE admins MODIFY role ENUM('admin','super_admin','counselor','dorm_manager') DEFAULT 'admin';
CREATE TABLE IF NOT EXISTS verification_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  building_id INT NULL,
  reservation_id INT NULL,
  outcome ENUM('ready','passed','duplicate','exception','rejected') NOT NULL,
  reason_code VARCHAR(50) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  result_json JSON NOT NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  resolution VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_verification_request (admin_id, request_id),
  KEY idx_verification_building_time (building_id, created_at),
  KEY idx_verification_reservation (reservation_id, created_at),
  KEY idx_verification_exception (outcome, resolved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS reservation_verifications (
  reservation_id INT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL UNIQUE,
  verified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (event_id) REFERENCES verification_events(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
