# 阿里数观

淘宝／天猫店铺经营分析前端演示系统。非阿里巴巴官方产品，所有指标、商品和趋势均为演示数据，没有连接真实店铺、支付或交易服务。

## 本地开发

需要 Node.js 20.19+ 或 22.12+。

```sh
npm ci --cache /tmp/ali-npm-cache
npm run dev -- --port 5173
```

生产构建：`npm run build`，预览：`npm run preview`。

支持店铺和周期筛选、商品搜索、品类筛选、销售额排序、商品详情、CSV 导出及本地工作空间名称保存。实时洞察仅表示演示界面，不代表真实实时数据连接。

真实数据接入需要淘宝开放平台的应用与店铺授权、服务端数据同步和访问控制；凭据不得放入前端代码。

## GitHub Pages 部署

已准备 `.github/workflows/deploy-pages.yml`，将 `main` 分支构建为 `/test1/` 子路径下的静态网站。

1. 当前账号的私有仓库不支持 Pages。可以保留私有并选择支持私有源码的其他托管方式，或由仓库所有者明确决定公开演示代码。不要为部署自动修改仓库可见性。
2. 将项目代码与工作流上传到 GitHub 的 `main` 分支。
3. 仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
4. Actions → Deploy demo to GitHub Pages → Run workflow；等待部署成功。
5. 使用工作流部署结果或 Pages 设置中返回的站点地址，不把预测地址当作已上线站点。

本地检查 Pages 构建：`npm run build -- --base /test1/`。默认开发命令不变。保存部署文件不代表已上传或已发布网站。
