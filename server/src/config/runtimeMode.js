const environment = process.env.NODE_ENV || 'development';

module.exports = {
  environment,
  production: environment === 'production',
  mockAllowed: environment !== 'production' && process.env.ALLOW_MOCK_SERVICES !== 'false',
  slotMinutes: Math.max(15, Number(process.env.RESERVATION_SLOT_MINUTES) || 30),
  dailyLimit: Math.max(1, Number(process.env.RESERVATION_DAILY_LIMIT) || 3),
  activeLimit: Math.max(1, Number(process.env.RESERVATION_ACTIVE_LIMIT) || 5)
};
