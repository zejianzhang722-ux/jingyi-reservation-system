CREATE TABLE IF NOT EXISTS reservation_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  reservation_id INT DEFAULT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'processing',
  response_json TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reservation_request (user_id, idempotency_key),
  INDEX idx_reservation_request_reservation (reservation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
