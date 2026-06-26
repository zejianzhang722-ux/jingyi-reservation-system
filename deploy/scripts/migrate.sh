#!/bin/sh
set -eu

node scripts/apply-reservation-consistency-migration.js
node scripts/apply-notification-outbox-migration.js
node scripts/apply-observability-audit-migration.js
node scripts/apply-backup-recovery-migration.js
node scripts/apply-performance-indexes-migration.js
node scripts/production-data-readiness-check.js
