# 页面截图

> 说明：本目录截图为 2026-11-04 的旧版界面；公共线重构后的首页、栏目、详情、参与与工作台版式尚未替换截图，以当前运行页面为准。
>
> 生成日期：2026-11-04
> 工具：Chrome headless + CDP；视口 1440×1200，整页截图。
> 数据：`server.py` 首次启动生成的演示夹具（真实业务入口产生），不是生产数据。
> 审图号：`SAMPLE-ONLY-NOT-A-REAL-AUDIT-NO`，仅本地演示；`map-gate-light.png` 为临时清除审图号后的合规闸门，截取后已恢复占位值。

| 文件 | 页面 | 演示身份 | 核对重点 |
|---|---|---|---|
| `map-light.png` | 地图（明） | 匿名 R0 | 审图号 badge；粗化点位；热力/清理量；无原始坐标 |
| `map-dark.png` | 地图（暗） | 匿名 R0 | 暗色令牌；热力色阶；对比度 |
| `map-gate-light.png` | 地图 · 审图号缺失 | ops_admin | **无点位**；合规闸门；前端不补审图号 |
| `map-mobile-light.png` | 地图 · 移动端（明） | rev_l1 | 390px 视口；移动导航按钮；无横向溢出 |
| `auth-light.png` | 登录 | 匿名 | 表单、演示账号、凭证找回阻塞提示 |
| `auth-error-light.png` | 登录失败 | 匿名 | `AUTH_INVALID`、trace_id、重试/去登录 |
| `report-light.png` | 随手拍上报 | ops_admin | 文件登记（FILE-01）、定位、类别/规模、无原始坐标 |
| `profile-light.png` | 个人中心 | ops_admin | RPT-02 列表、三段进度、闭环、评价入口、通知/设置阻塞 |
| `publicity-light.png` | 成效公示 | ops_admin | KPI、`published`、榜单默认关闭、对比/历史阻塞 |
| `knowledge-light.png` | 分类科普 | ops_admin | 类别来自 ADM-01；正文/答题阻塞 |
| `admin-workorders-light.png` | 运营后台 · 工单 | ops_admin | WO-01/02 表单；演示辅助；列表/组织名称缺口 |
| `admin-dashboard-light.png` | 运营后台 · 看板 | ops_admin | 内部视图；未发布标注；运营指标缺口 |
| `admin-dictionary-light.png` | 运营后台 · 字典 | ops_admin | 字典只读；审图号/榜单/粗化；枚举表 |
| `admin-reviews-light.png` | 运营后台 · 审核 | rev_l1 | 审核表单；字典回退 code；队列/详情缺口；SoD |

截图中的账号、编号、时间均为本地夹具；`SAMPLE-ONLY-*` 不是正式审图号，禁止在生产使用。
