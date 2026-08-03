# Windows 适配文档索引

- 分支：`feature/windows-adapt`（基于 main，29 commits ahead）
- 维护：`.hive/`（main 分支共享，跨分支可见）
- 生成时间：2026-08-03

本索引汇总 Windows 适配（Phase B-Win）全部相关文档。所有文档位于 `.hive/`，按用途分组，每项附简要描述与当前状态。

---

## 1. 平台耦合分析

| 文件 | 描述 | 状态 |
|------|------|------|
| `phase-a-analysis.md` | Windows 平台与既有 macOS/Linux 代码的平台耦合分析（Phase A 阶段产出，识别需增加 win32 分支的耦合点与降级策略切入点）。 | ⚠️ **缺失** — 仓库与 `.hive/` 中均未找到此文件；实际耦合分析散见于 `win-code-review.md`（§2 通过项）与 `windows-adapt-progress.md`（§2-§5 各模块"适配要点"）。建议补充或以 `windows-adapt-progress.md` 作为等价参考。 |

## 2. 代码审查

| 文件 | 描述 | 状态 |
|------|------|------|
| `win-code-review.md` | Windows 适配静态代码审查报告。覆盖 15 个 commit 的全量审查，按模块（权限降级 / 沙箱降级 / 存储 ACL / electron-builder / Windows 脚本 / userData 重定向 / shell-env / ripgrep）逐项核验 win32 分支与降级语义，列出 W-1 ~ W-7 共 7 项问题与 P1/P2/P3 优先级建议。 | ✅ 存在（180 行）|

## 3. 验收清单

| 文件 | 描述 | 状态 |
|------|------|------|
| `win-acceptance-checklist.md` | Windows 适配验收清单。8 节覆盖：构建验收（1369/1369 tests pass）、权限降级、存储（userData 重定向 + icacls ACL）、沙箱降级、GitHub Release 草稿、未完成项、风险备注、验收总结论（可合并到 main，不可直接发布为稳定版）。 | ✅ 存在（114 行）|

## 4. 构建验证

| 文件 | 描述 | 状态 |
|------|------|------|
| `win-build-verify.md` | Phase B-Win 初次构建验证 + 测试 + Push 报告。记录 build:main / preload / overlay 编译、主进程测试首次发现 1 例失败（os-permission-policy Windows microphone granted 分支）、修复后 1369/1369 pass、push 到 origin。基线 commit `0c5289ea2`。 | ✅ 存在（74 行）|
| `win-integration-status.md` | Phase B-Win 集成验证结果。commit 清单、与 main 的 merge-tree 冲突分析（0 冲突）、`npm ci` 依赖安装、`@maka/storage` / `@maka/runtime` 工作区构建、desktop build:main 回归（boot.ts localAppData TS2345，后由 `92c3e438b` 修复）、sandbox/credential 工作区测试 60 cases PASS。 | ✅ 存在（151 行）|
| `win-final-build.md` | Windows 最终构建验证（刷新版）。23 commits ahead of origin/main 时的全量构建：npm ci、build:main / preload / overlay、`node --test` 1395 pass / 0 fail、git push up-to-date。后续审查修复批次使总数增至 29 commits。 | ✅ 存在（102 行）|
| `win-final-test.md` | Windows 分支全量测试验证（最终）。test:checks（console/a11y/copy）全绿、build:main 零报错、主进程测试 1395 pass / 0 fail / 0 skip、29 commits 统计、git push up-to-date。 | ✅ 存在（107 行）|
| `win-push-verify.md` | Windows 分支最终 push 验证。29 commits、push up-to-date（HEAD = `c85a4bc54`）、PR #2 状态 OPEN、Release `v0.1.2-win.1` 仍为 Draft。 | ✅ 存在（57 行）|
| `win-ci-verify.md` | Windows CI Workflow 验证。核验 `.github/workflows/windows-ci.yml`：`runs-on: windows-latest`、Node 22、npm ci / build / test:checks / node --test 步骤齐备、触发条件限定 `feature/windows-adapt`。 | ✅ 存在（23 行）|

## 5. Release Notes

| 文件 | 描述 | 状态 |
|------|------|------|
| `win-release-notes.md` | Maka 0.1.2-win.1 Windows Preview Release Notes 草稿（200 行）。含概述、按模块的改动清单、已知限制（10 项）、P1/P2 修复状态（W-1 ~ W-7 全部闭环）、风险提示、测试入口建议、29 commits 完整列表。 | ✅ 存在（200 行）|
| `win-release-command.md` | `gh release create` 命令草稿（不执行）。目标仓库 / 分支 / 标签 / 标题 / notes 文件、推荐命令、5 项前置检查清单、备用（不自动建 tag）命令。明确标注"不要实际执行"。 | ✅ 存在（70 行）|

## 6. README

| 文件 | 描述 | 状态 |
|------|------|------|
| `windows-adapt-readme.md` | Maka Windows Preview 适配说明（面向使用/构建者）。7 节：概述、支持的 Windows 版本（10/11 x64）、已适配模块（权限 / shell-env / userData / 沙箱 / ACL / Tray / Acrylic / ripgrep / 构建脚本共 9 项）、已知限制（10 项）、构建步骤、测试、Release 流程。附相关文档链接。 | ✅ 存在（170 行）|

## 7. 最终总结

| 文件 | 描述 | 状态 |
|------|------|------|
| `win-final-summary.md` | Windows 适配最终完成总结。9 节：29 commits 统计、测试（1395/1395 pass）、审查修复（W-1 ~ W-7 全部闭环含修复 commit）、Release URL（Draft）、PR #2 URL、已知限制（10 项）、完成度评估（~97%）、关键文件索引、结论（代码层完整 / 测试全绿 / 审查闭环 / 具备草稿发布条件）。 | ✅ 存在（172 行）|

## 8. 进度跟踪（辅助）

| 文件 | 描述 | 状态 |
|------|------|------|
| `windows-adapt-progress.md` | Windows 适配进度汇总（早期基线，15 commits）。按子任务 #3a / #3b / #3c / #3d / #4 / #12 列出各模块 commits、改动文件、适配要点、剩余工作与风险。后续 commits 增长以 `win-final-build.md` / `win-final-test.md` / `win-final-summary.md` 为准。 | ✅ 存在（136 行）|

---

## 备注

- 任务列出的 7 类文档中，6 类在 `.hive/` 已就绪（代码审查、验收清单、构建验证、Release notes、README、最终总结）。
- `phase-a-analysis.md`（平台耦合分析）在仓库中未找到；平台耦合分析内容实际分布在 `win-code-review.md` §2 与 `windows-adapt-progress.md` §2-§5。如需独立 Phase A 分析文档，建议基于上述内容整理补齐。
- 构建验证类实际包含 6 个文档（初版 / 集成 / 最终构建 / 最终测试 / push / CI），覆盖从首次验证到最终 push 的完整链路。