// PM2 ecosystem file – run from the project root
// deploy.sh overwrites this with absolute paths; this version uses __dirname
// so it also works when started manually: pm2 start ecosystem.config.cjs

'use strict';
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'entralogin-api',
      script: 'src/server.js',
      cwd: path.resolve(__dirname, 'backend'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/entralogin/err.log',
      out_file:   '/var/log/entralogin/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      watch: false,
    },
  ],
};
