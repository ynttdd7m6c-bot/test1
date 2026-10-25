import { login } from './api.js';
export function renderLogin({ message = '', unavailable = false, onSuccess } = {}) {
  document.querySelector('#app').innerHTML = `
  <main class="login-layout">
    <section class="login-story">
      <a class="brand login-brand" href="./"><span class="logo">a<span>↗</span></span><strong>阿里数观<small>ALI INSIGHT</small></strong></a>
      <div class="login-story-copy"><span class="eyebrow">YOUR BUSINESS, IN FOCUS</span><h1>洞见生意增长，<br>守护每一份数据。</h1><p>连接你的团队与经营洞察，<br>在专属工作空间中安心协作。</p><div class="login-visual"><div class="visual-caption">经营数据 · 按角色授权 <span>◈</span></div><div class="visual-bars">${[35,52,43,67,58,80,72,95,88,110].map(h=>`<i style="height:${h}px"></i>`).join('')}</div><div class="visual-bottom"><span>身份验证</span><span>访问授权</span><span>安全会话</span></div></div></div>
      <small class="login-copyright">阿里数观 · 独立开发的电商分析工具</small>
    </section>
    <section class="login-form-side"><div class="login-card"><span class="login-lock">♙</span><h2>欢迎回来</h2><p class="login-subtitle">登录你的经营分析工作空间</p>
      <div class="login-message ${unavailable ? 'service-unavailable' : ''}" role="status" id="login-message" hidden></div>
      <form id="login-form"><label for="username">账号</label><input id="username" name="username" autocomplete="username" placeholder="请输入管理员分配的账号" required minlength="3" maxlength="40" pattern="[a-z0-9][a-z0-9_.\\-]{2,39}" ${unavailable?'disabled':''}>
      <label for="password">密码</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required minlength="12" maxlength="128" ${unavailable?'disabled':''}><button type="button" id="toggle-password" aria-label="显示密码">显示</button></div>
      <div class="login-help"><span>账号由管理员创建</span><button type="button" id="forgot-password">忘记密码？</button></div>
      <button class="login-submit" type="submit" ${unavailable?'disabled':''}>登录工作空间 <span>→</span></button></form>
      <div class="login-footnote"><span>◇</span> 登录后根据角色开放数据及管理功能</div>
      <div class="login-support" id="login-support" hidden>请联系工作空间管理员重置密码。系统不提供公开注册或默认账号。</div>
    </div><p class="login-disclaimer">非阿里巴巴官方产品 · 请勿输入淘宝或支付宝密码</p></section>
  </main>`;
  const info = document.querySelector('#login-message');
  if (message) { info.hidden = false; info.textContent = message; }
  document.querySelector('#toggle-password').onclick = () => {
    const field = document.querySelector('#password');
    const visible = field.type === 'password'; field.type = visible ? 'text' : 'password';
    const button = document.querySelector('#toggle-password'); button.textContent = visible ? '隐藏' : '显示'; button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
  };
  document.querySelector('#forgot-password').onclick = () => { document.querySelector('#login-support').hidden = false; };
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const button = document.querySelector('.login-submit');
    if (button.disabled) return;
    const username = document.querySelector('#username').value.trim();
    const password = document.querySelector('#password').value;
    button.disabled = true; button.textContent = '正在验证身份…'; info.hidden = true;
    try { await login(username, password); document.querySelector('#password').value = ''; await onSuccess(); }
    catch (error) {
      if (!document.querySelector('#login-form')) return;
      info.hidden = false; info.textContent = error.message;
      document.querySelector('#password').value = '';
    } finally {
      if (document.querySelector('.login-submit')) { button.disabled = false; button.innerHTML = '登录工作空间 <span>→</span>'; }
    }
  };
}
