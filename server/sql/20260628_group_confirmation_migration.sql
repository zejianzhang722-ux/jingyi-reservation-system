ALTER TABLE reservation_groups
  ADD COLUMN max_members INT NOT NULL DEFAULT 2 AFTER purpose,
  ADD COLUMN reservation_id INT DEFAULT NULL AFTER status,
  ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE reservation_groups
  ADD INDEX idx_reservation_groups_reservation (reservation_id),
  ADD CONSTRAINT fk_reservation_groups_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL;
