import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../dist/assets/' + readdirSync(new URL('../dist/assets/', import.meta.url)).find(x => x.endsWith('.js')), import.meta.url), 'utf8');
const user = role => ({id: 1, username: 'john.doe', displayName: '<img src=x onerror=alert(1)>', role, enabled: true});
const fixture = {products:[['<img src=x onerror=alert(1)>','<img src=x onerror=alert(2)>','系列','家居生活',100,10,1000,10]],metrics:{paymentAmount:1000,orders:10,visitors:100,conversionRate:10},workspaceName:'<img src=x onerror=alert(3)>'};
const until = async predicate => {for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5))}throw new Error('UI did not settle')};
function browser(handler){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost:5173',runScripts:'outside-only',pretendToBeVisual:true});
 dom.window.fetch=async(path,options={})=>handler(path,options);
 dom.window.scrollTo=()=>{};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'))};
 dom.window.eval(script);
 return dom;
}
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('anonymous page asks for login and contains no dashboard; failed password is cleared',async()=>{
 let loginBody;
 const dom=browser((path,options)=>{
  if(path==='/api/auth/me')return json(401,{error:'请先登录'});
  if(path==='/api/auth/login'){loginBody=JSON.parse(options.body);return json(401,{error:'账号或密码错误'})}
  throw new Error('unexpected request '+path);
 });
 try{
  const d=dom.window.document;await until(()=>d.querySelector('#login-form'));
  assert.equal(d.querySelector('.metrics'),null);
  assert.ok(new RegExp('^(?:'+d.querySelector('#username').pattern+')$','v').test('john.doe'));
  d.querySelector('#username').value='john.doe';d.querySelector('#password').value='wrong-password-for-test';
  d.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>d.querySelector('#login-message').textContent.includes('错误'));
  assert.equal(loginBody.username,'john.doe');assert.equal(d.querySelector('#password').value,'');assert.equal(d.querySelector('.metrics'),null);
  assert.equal(dom.window.localStorage.length,0);
 }finally{dom.window.close()}
});

test('static Pages missing backend fails closed without a demo login fallback',async()=>{
 const dom=browser(()=>new Response('<html>Not Found</html>',{status:404,headers:{'Content-Type':'text/html'}}));
 try{const d=dom.window.document;await until(()=>d.querySelector('#login-form'));assert.ok(d.querySelector('.login-submit').disabled);assert.match(d.querySelector('#login-message').textContent,/尚未部署/);assert.equal(d.querySelector('.metrics'),null)}finally{dom.window.close()}
});

for(const role of ['admin','analyst','viewer'])test(role+' sees permitted controls; injected display/product names render as text; logout removes private data',async()=>{
 let loggedOut=false;
 const dom=browser((path,options)=>{
  if(path==='/api/auth/me')return json(200,{user:user(role),csrfToken:'test-csrf-token'});
  if(path.startsWith('/api/dashboard?'))return json(200,fixture);
  if(path==='/api/auth/logout'){assert.equal(options.headers['X-CSRF-Token'],'test-csrf-token');loggedOut=true;return json(200,{ok:true})}
  throw new Error('unexpected '+path);
 });
 try{
  const d=dom.window.document;await until(()=>d.querySelector('.metrics'));
  assert.equal(!!d.querySelector('#export'),role!=='viewer');
  assert.equal(!!d.querySelector('[data-page="成员管理"]'),role==='admin');
  assert.equal(!!d.querySelector('[data-page="系统设置"]'),role==='admin');
  assert.equal(d.querySelector('img'),null);
  d.querySelector('[data-product]').click();assert.equal(d.querySelector('dialog img'),null);assert.match(d.querySelector('dialog h2').textContent,/<img/);
  d.querySelector('#logout').click();await until(()=>d.querySelector('#login-form'));
  assert.ok(loggedOut);assert.equal(d.querySelector('.metrics'),null);assert.equal(d.querySelector('dialog'),null);assert.equal(dom.window.localStorage.length,0);
 }finally{dom.window.close()}
});

test('revoked session on a subsequent request clears dashboard and prompts reauthentication',async()=>{
 let revoked=false;
 const dom=browser(path=>{
  if(path==='/api/auth/me')return json(200,{user:user('viewer'),csrfToken:'token'});
  if(path.startsWith('/api/dashboard?'))return revoked?json(401,{error:'session revoked'}):json(200,fixture);
  throw new Error('unexpected '+path);
 });
 try{const d=dom.window.document;await until(()=>d.querySelector('.metrics'));revoked=true;d.querySelector('[data-period="近7天"]').click();await until(()=>d.querySelector('#login-form'));assert.equal(d.querySelector('.metrics'),null);assert.match(d.querySelector('#login-message').textContent,/过期或权限已变更/)}finally{dom.window.close()}
});
