CREATE TABLE IF NOT EXISTS reservation_slots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  room_id INT NOT NULL,
  seat_id INT DEFAULT NULL,
  resource_key VARCHAR(64) NOT NULL,
  reservation_date DATE NOT NULL,
  slot_start TIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reservation_slot (room_id, reservation_date, resource_key, slot_start),
  INDEX idx_reservation_slots_reservation (reservation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
