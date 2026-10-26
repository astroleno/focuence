# Focuence 官网部署

公开地址：

- https://aitoshuu.me/Focuence
- https://tongye.me/Focuence

两者保留各自域名，使用同一份腾讯源站内容。`/Focuence` 和 `/Focuence/` 都直接返回页面，资源使用同源 `/Focuence/assets/` 路径。官网是介绍和合成数据示例；本机扩展的数据与分析没有搬到服务器。

## 当前结构

2026-10-25 实地核对：两个 `.me` 域名均解析到现有公网入口 `47.103.120.24`；腾讯上海轻量服务器为 `122.51.59.89`。保留现有 DNS、证书与原站点，只增加 Focuence 路径。

| 层级 | 路径与职责 |
| --- | --- |
| 腾讯源站 | `/srv/focuence/releases/<release>/` 保存白名单产物；`/srv/focuence/current` 指向当前版本 |
| 腾讯 Nginx | `/www/server/panel/vhost/nginx/focuence-origin.conf`，独立 `focuence-origin.internal` 虚拟主机 |
| 公网入口 | 两个现有 HTTPS vhost 各加入一行 `include /www/server/panel/vhost/nginx/focuence-public-locations.inc;` |
| 公网转发 | 共用 `/www/server/panel/vhost/snippets/focuence-proxy.inc`；保持原路径，指定腾讯源站 Host，不返回跨域跳转 |

源站、公共路由及转发配置的仓库副本在 [deploy/nginx](../deploy/nginx/)。源站不记录普通访问日志；公网入口沿用现有日志设置。页面没有外部字体、追踪脚本或第三方运行时，脚本与样式均来自本域名。CSP 禁止联网调用和原生表单提交。

## 构建与后续发布

1. 在仓库运行 `python3 scripts/build-website.py`（或 `npm run build:website`）。构建不读取模型、扩展运行数据、凭据或报告。
2. 只传输 `dist/website/` 中的文件到腾讯新的 `/srv/focuence/releases/<release>/`；核对 `release.json` 里全部文件的 SHA-256。
3. 使用同目录临时链接与重命名原子切换 `/srv/focuence/current`；保留上一个可用版本。新资产带内容哈希，HTML 与发布清单不缓存，带哈希的脚本/样式长期缓存。
4. 网站内容更新通常不需要修改公网转发配置。若变更 Nginx，先核对当前文件、备份受影响部分并通过 `nginx -t`，再重载。
5. 通过两个域名分别核验有无尾斜杠入口、发布清单及每个资源的哈希。测试主题选择、目标编辑、保存断点、继续与重置；确认原站根路径仍正常。

当前发布为 `focuence-site-7e1b2add0bb6`，共五个文件：HTML、CSS、JavaScript、图标和发布清单。两端的正式核验结果见 [verification.json](reviews/website-2026-10-25/verification.json)。

## 回滚边界

内容回滚只需将腾讯 `current` 原子切回上一版，并核对两个公开地址。首次发布之前没有 Focuence 版本；撤下官网时，在两个公网 HTTPS vhost 中仅移除本任务的 Focuence include，再验证并重载。

首次修改前的公网配置保存在入口服务器 `/www/backup/focuence/20261025-133157/`。验收时发现其它应用也在并行追加配置，已保留这些改动。**不得直接用整份旧备份覆盖当前 vhost**；回滚应核对差异，只撤销 Focuence 所属的行。确认没有引用后，才能移除本任务新增的两个 include 文件与源站 vhost。

## 已知边界

官网可以公开访问，扩展 2.5 仍为开发预览。此前确认的检索失效、返回提示上下文/时间范围和排除规则问题未在官网任务中修复。安装入口指向实际源码说明，没有伪造应用商店或稳定版下载。访问官网不会读取访问者的标签、浏览历史或扩展数据库；交互示例只在当前页面内保留合成状态和用户输入。
