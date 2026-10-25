# 阿里数观

淘宝／天猫经营分析系统，包含登录、服务端会话和角色授权。非阿里巴巴官方产品；目前所有经营指标仍为演示数据，没有连接淘宝、支付宝或真实交易服务。

## 权限

| 功能 | 管理员 admin | 分析员 analyst | 只读成员 viewer |
| --- | --- | --- | --- |
| 查看经营仪表盘、商品和详情 | ✓ | ✓ | ✓ |
| 导出 CSV 报表 | ✓ | ✓ | — |
| 修改工作空间设置 | ✓ | — | — |
| 创建账号、调整角色、停用账号、重置密码 | ✓ | — | — |

API 在服务端校验身份及角色。隐藏按钮只是界面优化，不是权限边界。没有公开注册和预设账号；用户名不是淘宝账号，密码也不要使用淘宝或支付宝密码。

## 本地运行

需要 Node.js 24+。数据库使用 Node 内置 SQLite，默认保存到 `data/ali-insight.sqlite`。此目录和 `.env` 不会提交到 Git。

```sh
npm ci --cache /tmp/ali-npm-cache
npm run create-admin
```

创建管理员时终端会询问账号、显示名称和密码；密码不回显，不要把密码放在命令行参数、源文件、GitHub Actions 或聊天中。至少 12 个字符，最大 128 字符。没有默认账号。账号创建后可在管理界面添加分析员及只读成员。

分别在两个终端运行：

```sh
npm run server:dev
npm run dev -- --port 5173 --strictPort
```

从 `http://localhost:5173` 登录。Vite 将 `/api` 代理到本机 3001 端口。开发来源默认只允许 `http://localhost:5173`，需要其他主机或端口时，在后端设置相同的 `APP_ORIGIN`，不要使用来源通配符。开发 Cookie 不带 Secure，仅用于本地 HTTP；不要将开发服务器用于公网运行。

```sh
npm run build
npm test
```

测试使用临时独立数据库，不会修改开发账号。SQLite 在部分 Node 24 版本中会显示实验特性提示。

## GitHub Pages 的边界

已有 `.github/workflows/deploy-pages.yml` 会将前端部署到 `/test1/`。GitHub Pages 不能运行 Node 后端、数据库或设置服务端 Cookie，所以公开地址只会显示登录入口及服务未连接提示，**不能在该地址直接完成身份验证**。没有假登录，也不再内置公开的仪表盘数据。访问者可以下载公开源代码及其中的演示样本；这不等于能访问你部署后的数据库。

要正式使用，必须将前端和 `/api` 同源部署到下面的完整服务地址。**不得把真实业务数据、导出文件、数据库或账号凭据提交到公开仓库或 Pages。**

## 带 HTTPS 的完整部署

已提供 Dockerfile、Docker Compose 与 Caddy 配置。需要你自己的 Linux 服务器、Docker Compose 和指向该服务器的域名；此项目没有替你购买或开通托管服务。

1. 将仓库拉取到服务器，复制 `.env.example` 为 `.env`，将 `SITE_DOMAIN` 改为你的域名，例如 `analytics.example.com`，不带协议和路径。
2. 让域名的 DNS 指向服务器，开放入站 80、443 端口。应用的 3001 端口只在容器网络内开放。
3. 运行：

```sh
docker compose up -d --build
docker compose exec app npm run create-admin
```

4. 用 `https://你的域名` 登录。Caddy 自动申请和续期 HTTPS 证书；证书签发依赖有效 DNS 和公网 80/443 连通性。
5. 使用管理员创建分析员、只读成员；分别验证权限。`GET /api/health` 检查服务存活，未登录请求 `/api/dashboard` 应返回 401。

生产模式必须设置 HTTPS 的 `APP_ORIGIN`（不带末尾 `/`）。Compose 自动使用 `https://SITE_DOMAIN`。`TRUST_PROXY=1` 仅用于当前单层可信 Caddy 代理；不要将应用直接暴露到公网或在任意代理后盲目开启，否则限流 IP 可能失真。

Docker 构建、证书签发及公网部署需在实际服务器执行；本云工作区的本地 API 验证不代表已经上线。

### 数据持久化和恢复

账号、密码哈希、会话及设置保存在 `app-data` 数据卷。更新镜像时保留该卷；**不要执行 `docker compose down -v`，否则将删除数据**。请采用 SQLite 在线备份接口或停服后备份数据库（含仍存在的 WAL/SHM 文件），并限制备份的读取权限。

管理员密码遗失时，可在服务器终端执行 `docker compose exec app npm run create-admin`，创建新的独立管理员账号，再登录重置原账号密码。需要服务器管理权限，不存在公开的重置接口。

## 登录实现

密码经随机盐 scrypt 哈希后存储。8 小时固定有效期的随机会话保存在 HttpOnly、SameSite=Strict Cookie 中，生产环境额外启用 Secure 和 `__Host-` 前缀。浏览器 localStorage 不保存令牌或角色，数据库仅保存会话令牌哈希。变更角色、停用、重置密码和退出都会撤销对应会话；最后一位启用管理员不能被停用或降级。

所有写入接口校验精确 Origin，登录之外还要求会话关联 CSRF Token。登录按账号、IP 和全局限流，错误消息不区分账号不存在、停用或密码错误。当前版本面向单实例部署；多副本需要共享数据库、限流和会话存储，不能直接用多份 SQLite 文件。

公开源码不影响服务器端会话保密。未来接入真实店铺数据时，还需根据店铺授权建立数据隔离；当前角色均属于同一工作空间，不提供多租户店铺级隔离。
