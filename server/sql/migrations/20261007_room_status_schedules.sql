-- Existing installations: back up the database before applying once.
ALTER TABLE rooms ADD COLUMN status_schedules JSON NULL COMMENT '临时状态起止时间，结束后回到长期状态';
