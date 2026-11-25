// Imported first by server.js: every local date in the desk is Dutch time.
if (!process.env.TZ) process.env.TZ = process.env.CAMPO_TZ || 'Europe/Amsterdam';
export {};
