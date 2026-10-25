import { resolve } from 'node:path';
import { createApp } from './app.js';

const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN) throw new Error('生产环境必须设置 APP_ORIGIN=https://你的域名（不带尾随斜杠）');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '1') throw new Error('TRUST_PROXY 仅接受 1；只能在可信的单层代理之后启用');
const { app, close } = createApp({
  dbPath: resolve(process.env.DB_PATH ?? 'data/ali-insight.sqlite'),
  production,
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === '1'
});
const server = app.listen(port, '0.0.0.0', () => console.log(`Ali Insight service listening on port ${port} (${production ? 'production' : 'development'})`));
function shutdown() { server.close(() => { close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
