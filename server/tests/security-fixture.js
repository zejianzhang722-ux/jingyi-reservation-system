// This preload runs only in the isolated security test server.
const tables = require('../src/config/mock-db').__tables;
const helpers = require('../src/utils/helpers');
const now = new Date();
const reservation = tables.reservations.find(row => row.id === 1);
reservation.date = helpers.formatDate(now);
reservation.start_time = helpers.formatTime(now);
reservation.end_time = helpers.minutesToTime(Math.min(1439, helpers.timeToMinutes(reservation.start_time) + 30));
