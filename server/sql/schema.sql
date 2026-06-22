CREATE DATABASE IF NOT EXISTS jingyi_reservation DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jingyi_reservation;

CREATE TABLE buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  address VARCHAR(200) DEFAULT '',
  floors INT DEFAULT 0,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('study_room', 'seminar_room', 'media_room', 'competition_room', 'roadshow_space', 'dance_room', 'reading_room', 'multi_purpose_hall', 'study_center', 'career_center', 'job_studio', 'innovation_workshop', 'party_room', 'national_defense_studio', 'mentor_room', 'counseling_room', 'shared_space', 'other') NOT NULL DEFAULT 'other',
  building_id INT,
  floor INT DEFAULT NULL,
  location VARCHAR(200) DEFAULT '',
  area DECIMAL(10,2) DEFAULT NULL,
  capacity INT DEFAULT NULL,
  open_start_time VARCHAR(10) DEFAULT NULL,
  open_end_time VARCHAR(10) DEFAULT NULL,
  max_duration INT DEFAULT 240,
  need_audit TINYINT(1) DEFAULT 0,
  need_counselor_audit TINYINT(1) DEFAULT 0,
  description TEXT,
  facilities TEXT,
  image_url VARCHAR(500) DEFAULT '',
  status ENUM('open', 'closed', 'maintenance') DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE seats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  seat_number INT NOT NULL,
  row_num INT DEFAULT 1,
  col_num INT DEFAULT 1,
  status ENUM('available', 'occupied', 'maintenance', 'disabled') DEFAULT 'available',
  has_power TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(100) DEFAULT NULL UNIQUE,
  session_key VARCHAR(100) DEFAULT NULL,
  name VARCHAR(50) DEFAULT '',
  nickname VARCHAR(50) DEFAULT '',
  avatar VARCHAR(500) DEFAULT '',
  phone VARCHAR(20) DEFAULT '',
  email VARCHAR(100) DEFAULT '',
  student_id VARCHAR(20) DEFAULT NULL UNIQUE,
  student_no VARCHAR(20) DEFAULT NULL UNIQUE,
  card_no VARCHAR(20) DEFAULT '',
  real_name VARCHAR(50) DEFAULT '',
  gender VARCHAR(10) DEFAULT '',
  college VARCHAR(100) DEFAULT '',
  major VARCHAR(100) DEFAULT '',
  grade VARCHAR(20) DEFAULT '',
  class_name VARCHAR(100) DEFAULT '',
  building_id INT DEFAULT NULL,
  room_number VARCHAR(20) DEFAULT '',
  role ENUM('student', 'counselor', 'admin', 'super_admin') DEFAULT 'student',
  credit_score INT DEFAULT 100,
  status ENUM('active', 'restricted', 'banned') DEFAULT 'active',
  restricted_until DATETIME DEFAULT NULL,
  noshow_count INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  room_id INT NOT NULL,
  seat_id INT DEFAULT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  purpose VARCHAR(500) DEFAULT '',
  participants INT DEFAULT 1,
  status ENUM('pending', 'counselor_pending', 'approved', 'rejected', 'cancelled', 'checked_in', 'completed', 'noshow') DEFAULT 'pending',
  reservation_code VARCHAR(30) DEFAULT NULL UNIQUE,
  reject_reason VARCHAR(500) DEFAULT '',
  audited_by INT DEFAULT NULL,
  audited_at DATETIME DEFAULT NULL,
  cancelled_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (seat_id) REFERENCES seats(id) ON DELETE SET NULL,
  INDEX idx_date_status (date, status),
  INDEX idx_user_date (user_id, date),
  INDEX idx_room_date (room_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE checkins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  user_id INT NOT NULL,
  room_id INT NOT NULL,
  checkin_time DATETIME NOT NULL,
  checkout_time DATETIME DEFAULT NULL,
  checkin_type ENUM('qrcode', 'manual', 'admin_manual', 'auto') DEFAULT 'qrcode',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE credits_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  score_change INT NOT NULL,
  score_after INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  description VARCHAR(500) DEFAULT '',
  related_id INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE violations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  description VARCHAR(500) NOT NULL,
  score INT NOT NULL,
  related_id INT DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE posters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(100) NOT NULL,
  organization VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  contact_name VARCHAR(50) DEFAULT '',
  contact_phone VARCHAR(20) DEFAULT '',
  description TEXT,
  image_url VARCHAR(500) DEFAULT '',
  position VARCHAR(100) DEFAULT '',
  position_index INT DEFAULT 0,
  status ENUM('pending', 'approved', 'rejected', 'cleaned', 'expired', 'violation') DEFAULT 'pending',
  reject_reason VARCHAR(500) DEFAULT '',
  approved_by INT DEFAULT NULL,
  approved_at DATETIME DEFAULT NULL,
  cleaned_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reading_room_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  enter_time DATETIME NOT NULL,
  leave_time DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_leave (user_id, leave_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(100) NOT NULL,
  content TEXT,
  data JSON DEFAULT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_read (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE feedbacks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  user_name VARCHAR(50) DEFAULT '',
  type ENUM('suggestion', 'bug', 'feature', 'other') DEFAULT 'suggestion',
  content TEXT NOT NULL,
  contact VARCHAR(100) DEFAULT '',
  status ENUM('pending', 'resolved') DEFAULT 'pending',
  reply TEXT,
  handled_by INT DEFAULT NULL,
  handled_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (handled_by) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservation_waitlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  room_id INT NOT NULL,
  seat_id INT DEFAULT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  status ENUM('waiting', 'converted', 'cancelled', 'expired') DEFAULT 'waiting',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  INDEX idx_room_date_status (room_id, date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservation_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) DEFAULT '',
  room_id INT NOT NULL,
  date DATE NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  purpose VARCHAR(500) DEFAULT '',
  status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
  created_by INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservation_group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  seat_id INT DEFAULT NULL,
  status ENUM('pending', 'confirmed', 'rejected') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES reservation_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(200) NOT NULL,
  real_name VARCHAR(50) DEFAULT '',
  role ENUM('admin', 'super_admin', 'counselor') DEFAULT 'admin',
  building_id INT DEFAULT NULL,
  phone VARCHAR(20) DEFAULT '',
  status ENUM('active', 'disabled') DEFAULT 'active',
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  operator_id INT NOT NULL,
  action VARCHAR(50) NOT NULL,
  target_table VARCHAR(50) DEFAULT '',
  target_id INT DEFAULT NULL,
  description VARCHAR(500) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_operator_created (operator_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  type ENUM('notice', 'maintenance', 'activity', 'emergency') DEFAULT 'notice',
  is_top TINYINT(1) DEFAULT 0,
  status ENUM('draft', 'published', 'archived') DEFAULT 'published',
  created_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE system_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value TEXT,
  description VARCHAR(200) DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
