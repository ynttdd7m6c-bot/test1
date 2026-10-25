import { resolve } from 'node:path';

export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  // Render supplies this canonical HTTPS URL; do not infer it from request headers.
  const configuredOrigin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (production && !configuredOrigin) {
    throw new Error('生产环境必须设置 APP_ORIGIN；Render 部署时可使用平台注入的 RENDER_EXTERNAL_URL');
  }
  const origin = configuredOrigin || 'http://localhost:5173';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) {
    throw new Error('服务来源必须是单个完整来源，生产环境必须使用 HTTPS（不带尾随斜杠）');
  }
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');
  if (env.TRUST_PROXY && env.TRUST_PROXY !== '1') throw new Error('TRUST_PROXY 仅接受 1；只能在可信的单层代理之后启用');
  return {
    production,
    port,
    origin,
    dbPath: resolve(env.DB_PATH ?? 'data/ali-insight.sqlite'),
    trustProxy: env.TRUST_PROXY === '1'
  };
}
