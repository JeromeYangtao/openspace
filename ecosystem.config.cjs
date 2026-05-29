module.exports = {
  apps: [
    {
      name: 'openspace',
      script: 'pnpm',
      args: 'start',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        OPENSPACE_HOME: process.env.OPENSPACE_HOME || '/var/lib/openspace',
      },
    },
  ],
};
