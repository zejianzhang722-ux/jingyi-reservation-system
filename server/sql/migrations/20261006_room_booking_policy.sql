-- Run with the existing database selected. Retains all reservation records.
ALTER TABLE rooms MODIFY COLUMN status ENUM('open','closed','maintenance','counselor_only') DEFAULT 'open';
UPDATE rooms SET status = 'counselor_only' WHERE type = 'party_room' AND status = 'open';
UPDATE rooms SET capacity = 15 WHERE type = 'innovation_workshop' AND (capacity IS NULL OR capacity < 1);
-- Capacity-shared bookings do not own exclusive room scope 0. Unique minute
-- slots remain, while the transactional room lock protects the capacity count.
UPDATE reservation_slots s JOIN rooms rm ON rm.id = s.room_id
SET s.seat_scope = -s.reservation_id
WHERE rm.type IN ('innovation_workshop','competition_room');
