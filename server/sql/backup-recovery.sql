CREATE TABLE IF NOT EXISTS backup_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  backup_id VARCHAR(80) NOT NULL,
  trigger_type ENUM('manual','scheduled','drill') NOT NULL DEFAULT 'manual',
  requested_by INT DEFAULT NULL,
  status ENUM('running','success','failed','verified','restored') NOT NULL DEFAULT 'running',
  file_name VARCHAR(255) DEFAULT NULL,
  size_bytes BIGINT DEFAULT NULL,
  checksum_sha256 CHAR(64) DEFAULT NULL,
  secondary_copied TINYINT(1) NOT NULL DEFAULT 0,
  error_message VARCHAR(1000) DEFAULT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_backup_runs_requester FOREIGN KEY (requested_by) REFERENCES admins(id) ON DELETE SET NULL,
  UNIQUE KEY uk_backup_runs_backup_id (backup_id),
  INDEX idx_backup_runs_status_started (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS data_archives (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  archive_id VARCHAR(120) NOT NULL,
  table_name VARCHAR(64) NOT NULL,
  cutoff_at DATETIME NOT NULL,
  row_count BIGINT NOT NULL DEFAULT 0,
  file_name VARCHAR(255) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status ENUM('archived_only','archived_and_purged','verified','failed') NOT NULL DEFAULT 'archived_only',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_data_archives_archive_id (archive_id),
  INDEX idx_data_archives_table_created (table_name, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
