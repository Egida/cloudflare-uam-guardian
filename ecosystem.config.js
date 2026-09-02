module.exports = {
  apps: [
    {
      name: 'uam-automation',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
