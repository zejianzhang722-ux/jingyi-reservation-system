const environment = process.env.NODE_ENV || 'development';

module.exports = {
  environment: environment,
  production: environment === 'production',
  mockAllowed: environment === 'test' || process.env.ALLOW_MOCK_SERVICES === 'true',
  slotMinutes: Number(process.env.RESERVATION_SLOT_MINUTES) || 30,
  dailyLimit: Number(process.env.RESERVATION_DAILY_LIMIT) || 3,
  activeLimit: Number(process.env.RESERVATION_ACTIVE_LIMIT) || 5
};
