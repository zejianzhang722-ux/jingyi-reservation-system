USE jingyi_reservation;

INSERT INTO buildings (id, name, address, floors, description) VALUES
(1, 'B座', '敬一书院B座', 6, '书院主楼B座'),
(2, 'C座', '敬一书院C座', 6, '书院主楼C座'),
(3, 'D座', '敬一书院D座', 6, '书院主楼D座'),
(4, '二期1幢', '敬一书院二期1幢', 6, '书院二期建筑');

INSERT INTO rooms (id, name, type, building_id, floor, location, area, capacity, open_start_time, open_end_time, max_duration, need_audit, need_counselor_audit, description, facilities, status) VALUES
(1, 'B228自习室', 'study_room', 1, 2, 'B座2楼228', NULL, 50, '00:00', '23:59', 240, 0, 0, 'B座2楼自习室，50个座位，24小时开放', 'WiFi,电源,空调', 'open'),
(2, 'B520自习室', 'study_room', 1, 5, 'B座5楼520', NULL, 36, '00:00', '23:59', 240, 0, 0, 'B座5楼自习室，36个座位，24小时开放', 'WiFi,电源,空调', 'open'),
(3, 'C110自习室', 'study_room', 2, 1, 'C座1楼110', NULL, 42, '00:00', '23:59', 240, 0, 0, 'C座1楼自习室，42个座位，24小时开放', 'WiFi,电源,空调', 'open'),
(4, 'D418自习室', 'study_room', 3, 4, 'D座4楼418', NULL, 15, '08:00', '21:00', 120, 0, 0, 'D座4楼自习室，15个座位，8:00-21:00开放', 'WiFi,电源,空调', 'open'),
(5, 'D510自习室', 'study_room', 3, 5, 'D座5楼510', NULL, 26, '00:00', '23:59', 240, 0, 0, 'D座5楼自习室，26个座位，24小时开放', 'WiFi,电源,空调', 'open'),
(6, 'B102研讨室', 'seminar_room', 1, 1, 'B座1楼102', NULL, 12, '08:00', '22:00', 180, 0, 0, 'B座1楼研讨室，12人，8:00-22:00', 'WiFi,投影,白板,空调', 'open'),
(7, 'B132研讨室', 'seminar_room', 1, 1, 'B座1楼132', NULL, 12, '08:00', '22:00', 180, 0, 0, 'B座1楼研讨室，12人，8:00-22:00', 'WiFi,投影,白板,空调', 'open'),
(8, 'B134研讨室', 'seminar_room', 1, 1, 'B座1楼134', NULL, 12, '08:00', '22:00', 180, 0, 0, 'B座1楼研讨室，12人，8:00-22:00', 'WiFi,投影,白板,空调', 'open'),
(9, 'C132研讨室', 'seminar_room', 2, 1, 'C座1楼132', NULL, 12, '08:00', '22:00', 180, 0, 0, 'C座1楼研讨室，12人，8:00-22:00', 'WiFi,投影,白板,空调', 'open'),
(10, 'D519研讨室', 'seminar_room', 3, 5, 'D座5楼519', NULL, 12, '08:00', '22:00', 180, 0, 0, 'D座5楼研讨室，12人，8:00-22:00', 'WiFi,投影,白板,空调', 'open'),
(11, 'C128影音室', 'media_room', 2, 1, 'C座1楼128', NULL, 30, '08:00', '23:00', 180, 0, 1, 'C座1楼影音室，30人，需辅导员审批', 'WiFi,投影,音响,空调', 'open'),
(12, 'C310备赛间', 'competition_room', 2, 3, 'C座3楼310', 93, NULL, '00:00', '23:59', 360, 0, 0, 'C座3楼备赛间，93㎡，24小时开放', 'WiFi,电源,白板,空调', 'open'),
(13, 'B128路演空间', 'roadshow_space', 1, 1, 'B座1楼128', NULL, NULL, '08:00', '23:00', 240, 0, 0, 'B座1楼路演空间，8:00-23:00', 'WiFi,投影,音响,空调', 'open'),
(14, 'D110舞蹈室', 'dance_room', 3, 1, 'D座1楼110', 93, NULL, '17:00', '22:00', 180, 0, 0, 'D座1楼舞蹈室，93㎡，17:00-22:00', 'WiFi,音响,镜子,空调', 'open'),
(15, 'D127阅览室', 'reading_room', 3, 1, 'D座1楼127', NULL, NULL, '09:00', '22:00', 0, 0, 0, 'D座1楼阅览室，9:00-22:00，无需预约', 'WiFi,空调', 'open'),
(16, 'D218多功能厅', 'multi_purpose_hall', 3, 2, 'D座2楼218', NULL, 20, '08:00', '23:00', 180, 0, 1, 'D座2楼多功能厅，20人，需辅导员审批', 'WiFi,投影,音响,空调', 'open'),
(17, 'C133学业辅导中心', 'study_center', 2, 1, 'C座1楼133', NULL, NULL, '08:00', '22:00', 180, 0, 0, 'C座1楼学业辅导中心', 'WiFi,白板,空调', 'open'),
(18, 'D132学业辅导中心', 'study_center', 3, 1, 'D座1楼132', NULL, NULL, '08:00', '22:00', 180, 0, 0, 'D座1楼学业辅导中心', 'WiFi,白板,空调', 'open'),
(19, 'C210生涯发展咨询室', 'career_center', 2, 2, 'C座2楼210', NULL, NULL, '08:00', '22:00', 120, 0, 0, 'C座2楼生涯发展咨询室', 'WiFi,空调', 'open'),
(20, 'D134求职就业工作室', 'job_studio', 3, 1, 'D座1楼134', NULL, NULL, '08:00', '22:00', 120, 0, 0, 'D座1楼求职就业工作室', 'WiFi,空调', 'open'),
(21, 'C228创新工作坊', 'innovation_workshop', 2, 2, 'C座2楼228', NULL, NULL, '08:00', '22:00', 180, 0, 0, 'C座2楼创新工作坊', 'WiFi,3D打印机,工具,空调', 'open'),
(22, 'D128党团活动室', 'party_room', 3, 1, 'D座1楼128', NULL, NULL, '08:00', '22:00', 180, 0, 0, 'D座1楼党团活动室', 'WiFi,投影,空调', 'open'),
(23, 'C102国防教育工作室', 'national_defense_studio', 2, 1, 'C座1楼102', NULL, NULL, '08:00', '22:00', 120, 0, 0, 'C座1楼国防教育工作室', 'WiFi,空调', 'open'),
(24, 'C129导师交流室', 'mentor_room', 2, 1, 'C座1楼129', NULL, NULL, '08:00', '22:00', 120, 0, 0, 'C座1楼导师交流室', 'WiFi,白板,空调', 'open'),
(25, 'C127心理咨询室', 'counseling_room', 2, 1, 'C座1楼127', NULL, NULL, '09:00', '21:00', 60, 0, 0, 'C座1楼心理咨询室', 'WiFi,空调', 'open'),
(26, 'D133共享空间', 'shared_space', 3, 1, 'D座1楼133', NULL, NULL, '08:00', '23:00', 240, 0, 0, 'D座1楼共享空间', 'WiFi,电源,空调', 'open');

INSERT INTO seats (room_id, seat_number, row_num, col_num, status, has_power) VALUES
(1, 1, 1, 1, 'available', 1), (1, 2, 1, 2, 'available', 1), (1, 3, 1, 3, 'available', 1), (1, 4, 1, 4, 'available', 1),
(1, 5, 1, 5, 'available', 1), (1, 6, 1, 6, 'available', 1), (1, 7, 1, 7, 'available', 1), (1, 8, 1, 8, 'available', 1),
(1, 9, 1, 9, 'available', 1), (1, 10, 1, 10, 'available', 1), (1, 11, 2, 1, 'available', 1), (1, 12, 2, 2, 'available', 1),
(1, 13, 2, 3, 'available', 1), (1, 14, 2, 4, 'available', 1), (1, 15, 2, 5, 'available', 1), (1, 16, 2, 6, 'available', 1),
(1, 17, 2, 7, 'available', 1), (1, 18, 2, 8, 'available', 1), (1, 19, 2, 9, 'available', 1), (1, 20, 2, 10, 'available', 1),
(1, 21, 3, 1, 'available', 1), (1, 22, 3, 2, 'available', 1), (1, 23, 3, 3, 'available', 1), (1, 24, 3, 4, 'available', 1),
(1, 25, 3, 5, 'available', 1), (1, 26, 3, 6, 'available', 1), (1, 27, 3, 7, 'available', 1), (1, 28, 3, 8, 'available', 1),
(1, 29, 3, 9, 'available', 1), (1, 30, 3, 10, 'available', 1), (1, 31, 4, 1, 'available', 1), (1, 32, 4, 2, 'available', 1),
(1, 33, 4, 3, 'available', 1), (1, 34, 4, 4, 'available', 1), (1, 35, 4, 5, 'available', 1), (1, 36, 4, 6, 'available', 1),
(1, 37, 4, 7, 'available', 1), (1, 38, 4, 8, 'available', 1), (1, 39, 4, 9, 'available', 1), (1, 40, 4, 10, 'available', 1),
(1, 41, 5, 1, 'available', 1), (1, 42, 5, 2, 'available', 1), (1, 43, 5, 3, 'available', 1), (1, 44, 5, 4, 'available', 1),
(1, 45, 5, 5, 'available', 1), (1, 46, 5, 6, 'available', 1), (1, 47, 5, 7, 'available', 1), (1, 48, 5, 8, 'available', 1),
(1, 49, 5, 9, 'available', 1), (1, 50, 5, 10, 'available', 1);

INSERT INTO seats (room_id, seat_number, row_num, col_num, status, has_power) VALUES
(2, 1, 1, 1, 'available', 1), (2, 2, 1, 2, 'available', 1), (2, 3, 1, 3, 'available', 1), (2, 4, 1, 4, 'available', 1),
(2, 5, 1, 5, 'available', 1), (2, 6, 1, 6, 'available', 1), (2, 7, 1, 7, 'available', 1), (2, 8, 1, 8, 'available', 1),
(2, 9, 1, 9, 'available', 1), (2, 10, 1, 10, 'available', 1), (2, 11, 2, 1, 'available', 1), (2, 12, 2, 2, 'available', 1),
(2, 13, 2, 3, 'available', 1), (2, 14, 2, 4, 'available', 1), (2, 15, 2, 5, 'available', 1), (2, 16, 2, 6, 'available', 1),
(2, 17, 2, 7, 'available', 1), (2, 18, 2, 8, 'available', 1), (2, 19, 2, 9, 'available', 1), (2, 20, 2, 10, 'available', 1),
(2, 21, 3, 1, 'available', 1), (2, 22, 3, 2, 'available', 1), (2, 23, 3, 3, 'available', 1), (2, 24, 3, 4, 'available', 1),
(2, 25, 3, 5, 'available', 1), (2, 26, 3, 6, 'available', 1), (2, 27, 3, 7, 'available', 1), (2, 28, 3, 8, 'available', 1),
(2, 29, 3, 9, 'available', 1), (2, 30, 3, 10, 'available', 1), (2, 31, 4, 1, 'available', 1), (2, 32, 4, 2, 'available', 1),
(2, 33, 4, 3, 'available', 1), (2, 34, 4, 4, 'available', 1), (2, 35, 4, 5, 'available', 1), (2, 36, 4, 6, 'available', 1);

INSERT INTO seats (room_id, seat_number, row_num, col_num, status, has_power) VALUES
(3, 1, 1, 1, 'available', 1), (3, 2, 1, 2, 'available', 1), (3, 3, 1, 3, 'available', 1), (3, 4, 1, 4, 'available', 1),
(3, 5, 1, 5, 'available', 1), (3, 6, 1, 6, 'available', 1), (3, 7, 1, 7, 'available', 1), (3, 8, 1, 8, 'available', 1),
(3, 9, 1, 9, 'available', 1), (3, 10, 1, 10, 'available', 1), (3, 11, 1, 11, 'available', 1), (3, 12, 1, 12, 'available', 1),
(3, 13, 1, 13, 'available', 1), (3, 14, 1, 14, 'available', 1), (3, 15, 2, 1, 'available', 1), (3, 16, 2, 2, 'available', 1),
(3, 17, 2, 3, 'available', 1), (3, 18, 2, 4, 'available', 1), (3, 19, 2, 5, 'available', 1), (3, 20, 2, 6, 'available', 1),
(3, 21, 2, 7, 'available', 1), (3, 22, 2, 8, 'available', 1), (3, 23, 2, 9, 'available', 1), (3, 24, 2, 10, 'available', 1),
(3, 25, 2, 11, 'available', 1), (3, 26, 2, 12, 'available', 1), (3, 27, 2, 13, 'available', 1), (3, 28, 2, 14, 'available', 1),
(3, 29, 3, 1, 'available', 1), (3, 30, 3, 2, 'available', 1), (3, 31, 3, 3, 'available', 1), (3, 32, 3, 4, 'available', 1),
(3, 33, 3, 5, 'available', 1), (3, 34, 3, 6, 'available', 1), (3, 35, 3, 7, 'available', 1), (3, 36, 3, 8, 'available', 1),
(3, 37, 3, 9, 'available', 1), (3, 38, 3, 10, 'available', 1), (3, 39, 3, 11, 'available', 1), (3, 40, 3, 12, 'available', 1),
(3, 41, 3, 13, 'available', 1), (3, 42, 3, 14, 'available', 1);

INSERT INTO seats (room_id, seat_number, row_num, col_num, status, has_power) VALUES
(4, 1, 1, 1, 'available', 1), (4, 2, 1, 2, 'available', 1), (4, 3, 1, 3, 'available', 1),
(4, 4, 1, 4, 'available', 1), (4, 5, 1, 5, 'available', 1), (4, 6, 2, 1, 'available', 1),
(4, 7, 2, 2, 'available', 1), (4, 8, 2, 3, 'available', 1), (4, 9, 2, 4, 'available', 1),
(4, 10, 2, 5, 'available', 1), (4, 11, 3, 1, 'available', 1), (4, 12, 3, 2, 'available', 1),
(4, 13, 3, 3, 'available', 1), (4, 14, 3, 4, 'available', 1), (4, 15, 3, 5, 'available', 1);

INSERT INTO seats (room_id, seat_number, row_num, col_num, status, has_power) VALUES
(5, 1, 1, 1, 'available', 1), (5, 2, 1, 2, 'available', 1), (5, 3, 1, 3, 'available', 1),
(5, 4, 1, 4, 'available', 1), (5, 5, 1, 5, 'available', 1), (5, 6, 1, 6, 'available', 1),
(5, 7, 1, 7, 'available', 1), (5, 8, 1, 8, 'available', 1), (5, 9, 1, 9, 'available', 1),
(5, 10, 1, 10, 'available', 1), (5, 11, 2, 1, 'available', 1), (5, 12, 2, 2, 'available', 1),
(5, 13, 2, 3, 'available', 1), (5, 14, 2, 4, 'available', 1), (5, 15, 2, 5, 'available', 1),
(5, 16, 2, 6, 'available', 1), (5, 17, 2, 7, 'available', 1), (5, 18, 2, 8, 'available', 1),
(5, 19, 2, 9, 'available', 1), (5, 20, 2, 10, 'available', 1), (5, 21, 3, 1, 'available', 1),
(5, 22, 3, 2, 'available', 1), (5, 23, 3, 3, 'available', 1), (5, 24, 3, 4, 'available', 1),
(5, 25, 3, 5, 'available', 1), (5, 26, 3, 6, 'available', 1);

INSERT INTO admins (id, username, password, real_name, role, building_id, phone, status) VALUES
(1, 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '系统管理员', 'admin', NULL, '13800000001', 'active'),
(2, 'superadmin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', '超级管理员', 'super_admin', NULL, '13800000002', 'active');

INSERT INTO users (id, openid, nickname, name, avatar, phone, student_id, student_no, card_no, real_name, gender, college, major, grade, class_name, building_id, room_number, role, credit_score, status) VALUES
(1, 'test_openid_001', '张三', '张三', '', '13900000001', '2024001001', '2024001001', '200001', '张三', '男', '敬一书院', '软件工程', '2024', '2024级1班', 1, 'B301', 'student', 80, 'active'),
(2, 'test_openid_002', '李四', '李四', '', '13900000002', '2024001002', '2024001002', '200002', '李四', '女', '敬一书院', '计算机科学', '2024', '2024级2班', 2, 'C205', 'student', 95, 'active');

INSERT INTO reservations (user_id, room_id, seat_id, date, start_time, end_time, purpose, participants, status, reservation_code, created_at) VALUES
(1, 1, 1, CURDATE(), '09:00', '12:00', '自习备考', 1, 'approved', 'JYTEST001', NOW()),
(2, 1, 2, CURDATE(), '14:00', '17:00', '课程复习', 1, 'approved', 'JYTEST002', NOW()),
(2, 6, NULL, CURDATE(), '10:00', '12:00', '小组讨论', 8, 'approved', 'JYTEST003', NOW()),
(1, 2, 11, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '09:00', '11:00', '自习', 1, 'approved', 'JYTEST004', NOW()),
(2, 11, NULL, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '14:00', '17:00', '观影活动', 20, 'counselor_pending', 'JYTEST005', NOW()),
(2, 12, NULL, DATE_ADD(CURDATE(), INTERVAL 2 DAY), '08:00', '14:00', '数学建模备赛', 5, 'approved', 'JYTEST006', NOW()),
(2, 9, NULL, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '15:00', '18:00', '项目研讨', 6, 'pending', 'JYTEST007', NOW()),
(2, 5, 21, CURDATE(), '19:00', '22:00', '自习', 1, 'checked_in', 'JYTEST008', NOW()),
(1, 1, 1, DATE_SUB(CURDATE(), INTERVAL 1 DAY), '08:00', '10:00', '自习', 1, 'noshow', 'JYTEST009', DATE_SUB(NOW(), INTERVAL 1 DAY)),
(1, 6, NULL, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '14:00', '16:00', '小组讨论', 6, 'pending', 'JYTEST010', NOW()),
(1, 11, NULL, CURDATE(), '19:00', '21:00', '观影活动', 15, 'completed', 'JYTEST011', NOW()),
(1, 3, 5, DATE_ADD(CURDATE(), INTERVAL 1 DAY), '09:00', '12:00', '自习', 1, 'approved', 'JYTEST012', NOW()),
(1, 17, NULL, DATE_ADD(CURDATE(), INTERVAL 2 DAY), '10:00', '11:00', '学业辅导', 3, 'approved', 'JYTEST013', NOW());

INSERT INTO credits_log (user_id, score_change, score_after, type, description, related_id, created_at) VALUES
(1, -20, 80, 'noshow', '爽约 - B228自习室，预约开始后15分钟内未签到', 9, DATE_SUB(NOW(), INTERVAL 1 DAY)),
(1, -5, 75, 'warning', '临近开始时间取消预约', 9, DATE_SUB(NOW(), INTERVAL 1 MINUTE)),
(1, 5, 80, 'good_behavior', '正常使用功能房 - B228自习室，按时签到并签退', 1, NOW()),
(2, 5, 95, 'good_behavior', '正常使用功能房 - B228自习室', 2, NOW()),
(2, 5, 95, 'good_behavior', '正常使用功能房 - B102共享空间', 3, NOW());

INSERT INTO system_config (config_key, config_value, description) VALUES
('reservation.advance_days', '3', '可提前预约天数'),
('reservation.cancel_before_hours', '3', '取消预约提前小时数'),
('reservation.late_minutes', '15', '迟到签到允许分钟数'),
('reservation.noshow_count_limit', '3', '爽约次数限制'),
('reservation.noshow_pause_days', '7', '爽约暂停预约天数'),
('reservation.daily_limit', '3', '每日预约次数限制'),
('credit.initial_score', '100', '初始信用分'),
('credit.max_score', '120', '信用分上限'),
('credit.noshow_penalty', '-20', '爽约扣分'),
('credit.violation_penalty', '-10', '违规扣分'),
('credit.good_reward', '5', '良好行为奖励'),
('credit.good_threshold', '10', '良好行为判定次数'),
('credit.feedback_reward', '3', '反馈奖励'),
('credit.warning_threshold', '80', '信用分警告阈值'),
('credit.restrict_threshold', '60', '信用分限制阈值'),
('credit.ban_threshold', '30', '信用分封禁阈值'),
('credit.restrict_days', '7', '限制天数'),
('credit.ban_days', '30', '封禁天数');

INSERT INTO announcements (title, content, type, is_top, status, created_by) VALUES
('欢迎使用敬一书院功能房预约系统', '欢迎使用敬一书院功能房预约系统，请遵守使用规则，文明预约。', 'notice', 1, 'published', 1),
('自习室使用须知', '1. 请按时签到签退\n2. 请勿占座\n3. 保持安静\n4. 爱护公共设施', 'notice', 0, 'published', 1);
