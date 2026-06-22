module.exports = {
  apps: [
    {
      name: 'jingyi-api',
      script: 'src/app.js',
      cwd: '/var/www/jingyi-reservation/server',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_file: '.env',
      max_memory_restart: '512M',
      error_file: '/var/log/jingyi/error.log',
      out_file: '/var/log/jingyi/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    }
  ]
};
