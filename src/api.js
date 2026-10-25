export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
let session = null;
export const getSession = () => session;
export const clearSession = () => { session = null; };
export const canExport = () => ['admin', 'analyst'].includes(session?.user.role);
export const isAdmin = () => session?.user.role === 'admin';

export async function request(path, { method = 'GET', body, ...options } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && session?.csrfToken) headers['X-CSRF-Token'] = session.csrfToken;
  let response;
  try {
    response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', cache: 'no-store', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new ApiError('无法连接登录服务，请检查网络或联系管理员。');
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json') && !type.includes('text/csv')) {
    throw new ApiError('登录服务尚未部署，请联系管理员。', response.status);
  }
  if (!response.ok) {
    const data = type.includes('application/json') ? await response.json().catch(() => ({})) : {};
    if (response.status === 401 && session) {
      session = null;
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(data.error || data.message || (response.status === 403 ? '你没有执行此操作的权限。' : '请求未完成，请稍后重试。'), response.status);
  }
  if (type.includes('text/csv')) return response.blob();
  if (response.status === 204) return null;
  return response.json();
}
export async function restoreSession() {
  session = await request('/api/auth/me');
  return session;
}
export async function login(username, password) {
  session = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  return session;
}
export async function logout() {
  await request('/api/auth/logout', { method: 'POST', body: {} });
  session = null;
}
