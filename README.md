# 新媒体运营工作台

个人媒体运营管理工具。

GitHub Pages: https://qianshan797.github.io/qingqiu-media-workbench/

## 文件结构说明

原 `media-workflow-tool.html` 已合并入 `index.html`，仓库根目录自 2026-09-14 起仅维护单一入口文件：

- `index.html` — 工作台主文件（合并了原 media-workflow-tool 的全部功能）
- `news-data.json` — 每日快讯数据（由定时任务更新）
- `.nojekyll` — 禁用 Jekyll，让 GitHub Pages 直接托管根目录文件
- `.github/workflows/pages.yml` — GitHub Pages 部署工作流
- `README.md` — 本文件

后续所有功能迭代、Bug 修复、数据同步逻辑变更均只改动 `index.html`。
