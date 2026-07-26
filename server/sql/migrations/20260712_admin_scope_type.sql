ALTER TABLE admins
  ADD COLUMN scope_type ENUM('global', 'building') DEFAULT NULL AFTER building_id;

UPDATE admins
SET scope_type = 'global', building_id = NULL
WHERE role IN ('super_admin', 'superadmin', 'counselor');

UPDATE admins
SET scope_type = 'building'
WHERE role = 'admin' AND building_id IS NOT NULL AND building_id > 0;

-- Existing guide accounts with both fields empty intentionally remain unresolved.
-- A super administrator must choose global or a specific building for each one.
