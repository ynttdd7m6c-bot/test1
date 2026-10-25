import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createStore, ROLES } from './store.js';

function hiddenInput(prompt) {
  return new Promise((resolveInput, reject) => {
    if (!stdin.isTTY || !stdin.setRawMode) return reject(new Error('请在交互式终端中运行，密码不得通过命令行参数传递'));
    let password = '';
    stdin.setEncoding('utf8'); stdin.setRawMode(true); stdin.resume();
    const cleanup = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') { cleanup(); reject(new Error('已取消')); return; }
        if (character === '\r' || character === '\n') { cleanup(); resolveInput(password); return; }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ') password += character;
        if (password.length > 128) { cleanup(); reject(new Error('密码不能超过 128 个字符')); return; }
      }
    };
    stdin.on('data', onData);
    // Enable raw mode before displaying the prompt so an immediate paste cannot echo.
    stdout.write(prompt);
  });
}
const command = process.argv[2];
if (!['create-admin', 'create-user'].includes(command) || process.argv.length !== 3) {
  console.error('用法：node server/manage-users.js create-admin|create-user');
  process.exitCode = 1;
} else {
  let store;
  let rl;
  try {
    if (!stdin.isTTY) throw new Error('请使用交互式终端（Docker 需使用 -it），密码不会回显');
    rl = createInterface({ input: stdin, output: stdout });
    const username = (await rl.question('账号（3–40 位小写字母、数字或 ._-）：')).trim().toLowerCase();
    const displayName = (await rl.question('显示名称：')).trim();
    const role = command === 'create-admin' ? 'admin' : (await rl.question('角色（admin / analyst / viewer）：')).trim();
    if (!ROLES.includes(role)) throw new Error('角色无效');
    rl.close(); rl = null;
    const password = await hiddenInput('密码（12–128 字符，不回显）：');
    const confirm = await hiddenInput('再次输入密码：');
    if (password !== confirm) throw new Error('两次密码不一致');
    store = createStore(resolve(process.env.DB_PATH ?? 'data/ali-insight.sqlite'));
    const user = await store.createUser({ username, displayName, role, password });
    console.log(`已创建 ${user.username}（${user.role}），请从登录页面使用该账号。`);
  } catch (err) {
    // Avoid printing SQLite statement arguments or credential material.
    console.error(err.code?.startsWith('ERR_SQLITE') ? '账号创建失败：名称可能已存在，请检查数据目录和账号名称' : err.message);
    process.exitCode = 1;
  } finally { rl?.close(); store?.close(); }
}
