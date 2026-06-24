-- 候补队列并发一致性：同一用户、同一房间/座位范围、同一日期和时间段
-- 最多只能存在一条 status='waiting' 的有效候补记录。
--
-- 执行前必须先运行 scripts/reservation-migration-precheck.js，
-- 并人工处理 duplicateActiveWaitlistEntries；生产环境推荐统一执行
-- scripts/apply-reservation-consistency-migration.js，以获得可恢复和重复执行能力。

ALTER TABLE reservation_waitlist
  ADD COLUMN waiting_seat_scope INT
    GENERATED ALWAYS AS (
      CASE
        WHEN status = 'waiting' THEN COALESCE(seat_id, 0)
        ELSE NULL
      END
    ) STORED AFTER status;

ALTER TABLE reservation_waitlist
  ADD UNIQUE KEY uk_waitlist_user_slot (
    user_id,
    room_id,
    waiting_seat_scope,
    date,
    start_time,
    end_time
  );
