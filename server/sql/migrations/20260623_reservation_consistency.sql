-- 第三阶段：预约并发一致性、时间槽唯一约束与幂等键
-- 执行前请先备份数据库，并确认不存在重复的有效预约。

ALTER TABLE reservations
  ADD COLUMN idempotency_key VARCHAR(128) DEFAULT NULL AFTER reservation_code,
  ADD COLUMN request_hash CHAR(64) DEFAULT NULL AFTER idempotency_key,
  ADD UNIQUE KEY uk_reservation_user_idempotency (user_id, idempotency_key);

CREATE TABLE reservation_slots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  room_id INT NOT NULL,
  seat_scope INT NOT NULL DEFAULT 0 COMMENT '0表示整间功能房；非0表示具体座位ID',
  date DATE NOT NULL,
  slot_minute SMALLINT UNSIGNED NOT NULL COMMENT '自00:00起的分钟数，范围0-1439',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reservation_slots_reservation
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  CONSTRAINT fk_reservation_slots_room
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE KEY uk_room_seat_date_minute (room_id, seat_scope, date, slot_minute),
  INDEX idx_reservation_slots_reservation (reservation_id),
  INDEX idx_reservation_slots_lookup (room_id, date, seat_scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 历史有效预约回填时间槽。发生唯一键冲突说明历史数据已经存在双订，
-- 应先人工处理冲突记录，再重新执行回填。
INSERT INTO reservation_slots (reservation_id, room_id, seat_scope, date, slot_minute)
SELECT
  r.id,
  r.room_id,
  COALESCE(r.seat_id, 0),
  r.date,
  seq.n
FROM reservations r
JOIN (
  SELECT ones.n + tens.n * 10 + hundreds.n * 100 AS n
  FROM
    (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
     SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) ones
  CROSS JOIN
    (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
     SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) tens
  CROSS JOIN
    (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
     SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL
     SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14) hundreds
) seq
  ON seq.n >= TIME_TO_SEC(STR_TO_DATE(r.start_time, '%H:%i')) / 60
 AND seq.n < TIME_TO_SEC(STR_TO_DATE(r.end_time, '%H:%i')) / 60
WHERE r.status IN ('pending', 'counselor_pending', 'approved', 'checked_in');
