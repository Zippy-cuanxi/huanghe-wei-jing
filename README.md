# 黄河戍境 · 黄河垃圾热力地图（GitHub Pages 静态演示镜像）

在线地址：<https://zippy-cuanxi.github.io/huanghe-wei-jing/>

> 本仓库是**静态演示镜像**，用于在其他电脑上通过公网链接直接打开、浏览与交互。
> 原项目是「Vue 3 单页 + Python(SQLite) 后端」的完整应用，GitHub Pages 只能托管静态文件，
> 无法运行 Python 后端。因此本镜像在浏览器内模拟那 14 个契约接口，数据全部来自项目自带的
> 权威响应样例（`samples/`），**不含真实数据库、真实鉴权、真实业务数据**。

## 这个镜像能做什么

| 项目 | 静态演示镜像 | 本地完整项目 |
| --- | --- | --- |
| 页面 / 路由 / 明暗主题 | 完整可用 | 完整可用 |
| 地图、成效公示、科普、上报、个人中心、运营后台 | 可浏览、可交互 | 可浏览、可交互 |
| 数据来源 | 浏览器内样例回放 | Python 后端 + SQLite |
| 登录 | 演示账号 + 固定演示口令，本地模拟 | 真实会话、锁号、幂等、审计 |
| 写入操作 | 仅存 localStorage，刷新保留 | 落库并参与状态机 |
| 公网访问 | 支持 | 需自行部署后端 |

演示账号：`ops_admin`（推荐，权限最全）、`user_r1`、`rev_l1`、`rev_l2`、`rev_l3`、
`org_a_op`、`sys_admin`、`auditor`，统一口令 `Demo#Pass2026`。
口令同样写在页面顶部横幅里，方便他人在别的电脑上直接试用。

## GitHub Pages 配置（本仓库实际采用）

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| 仓库可见性 | Public | 免费账户的 Pages 站点随仓库公开；私有仓库需付费方案 |
| 部署方式 | Deploy from a branch | 不启用 GitHub Actions，纯静态无需构建 |
| 分支 | `main` | 推送即触发重新发布 |
| 发布目录 | `/ (root)` | 入口文件必须位于仓库根目录 |
| 入口文件 | `index.html` | 全小写、文件名不可改；根目录必须存在 |
| `.nojekyll` | 根目录空文件 | 让 Pages 跳过 Jekyll，避免以下划线开头的文件/目录被忽略 |
| 自定义域名 | 未设置 | 如需绑定自己的域名，在 Pages 设置里填 Custom domain 并加 `CNAME` 文件 |

站点类型：**项目站点（Project site）**，因此 URL 带仓库名子路径
`https://<用户名>.github.io/<仓库名>/`。若改成用户站点（仓库命名为
`<用户名>.github.io`），URL 会变成根路径 `https://<用户名>.github.io/`，
但发布目录仍必须是 `/ (root)`、入口仍必须是 `index.html`。

## 目录结构

```
index.html                  入口（必须叫这个名字，位于发布目录根）
.nojekyll                   跳过 Jekyll
assets/                     原项目静态资源，路径均为相对路径
  vue.global.prod.js        Vue 3 本地构建，无 CDN
  app.js / lib.js / ...     ES Modules 单页应用
  views/                    F1–F5 页面组件
  styles.css                样式与明暗主题
static-demo/
  fixtures.js               由 samples/ 权威样例生成的响应信封
  mock-api.js               浏览器内 fetch 拦截与接口模拟 + 合规说明横幅
README.md                   本文件
```

原项目里的 `server.py`、`backend/`、`var/app.db`、`docs/`、`samples/`、`tools/`
**没有**发布：Pages 无法运行 Python，也不应把本地数据库与后端源码放到公网仓库。

## 合规说明

- 热力地图是**自绘 SVG 示意网格**，不加载任何第三方地图 SDK 或瓦片服务；
- `map_audit_no` 保持 `SAMPLE-ONLY-...` 占位值，页面会显示「当前审图号为演示占位」警示，
  顶部横幅也明确标注「非标准地图，不作为测绘、地理或合规依据」；
- 所有点位为虚构示例岸段的粗化坐标，不含真实个人位置信息；
- **本镜像不得作为正式对外发布的地图产品使用**。正式上线前须接入合规底图与授权审图号，
  移除演示账号与占位审图号，并完成安全、备份与并发评估（见原项目 README 第 8 节）。

## 如何更新

源项目改动后，在生成脚本所在目录执行：

```bash
python build_pages.py
cd huanghe-pages
git add -A && git commit -m "update static demo" && git push
```

推送后 GitHub Pages 通常几十秒内自动重新构建。

## 本地运行完整版（含真实后端）

静态镜像不含后端。需要真实联调时，回到源项目目录：

```bash
python server.py     # 或双击 run.bat，访问 http://127.0.0.1:8000/
```

要求 Python 3.11+，无第三方依赖；接口清单与演示账号见原项目 `README.md`。
