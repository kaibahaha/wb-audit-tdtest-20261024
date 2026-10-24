# wb-audit-tdtest (隔离测试仓库)

本仓库由「无人软件工厂端到端能力摸底」审计脚本创建，用于验证：
代码提交 → GitHub Actions 自动运行 → Playwright 浏览器测试 → GitHub Pages 部署 的完整链路。

这是一个最小可用的纯网页版文字塔防游戏（无构建步骤，单文件 `index.html`）。

- `index.html`：文字塔防游戏
- `tests/tower.spec.js`：Playwright 功能测试
- `.github/workflows/ci.yml`：CI（Playwright 测试）+ Pages 部署

> 此仓库为审计产物，可随时删除。
