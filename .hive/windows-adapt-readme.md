# Maka Windows Preview — 适配说明

> 分支：`feature/windows-adapt`（基于 main，21 commits ahead）
> 版本：`0.1.2-win.1`（草稿）
> 文档维护：`.hive/`（main 分支共享，跨分支可见）

---

## 1. 概述

Maka Windows Preview 是 Maka 桌面端首个 Windows (x64) 适配预览。Windows 平台此前不在支持矩阵中，本分支在 **不改动既有 macOS/Linux 行为** 的前提下，为 Windows 增加平台分支、降级策略与打包脚本，使产品可在 Windows 上以受限能力运行。

技术栈基于 **Electron** 桌面壳 + **win32 平台适配**：在主进程（`apps/desktop/src/main/`）、运行时（`packages/runtime`）、存储（`packages/storage`）与构建脚本（`scripts/`）四个模块中新增 Windows 分支。本版本为 **预览 (preview)**，部分能力以降级方式运行，详见第 4 节"已知限制"。

本次适配共 21 个提交（相对 `main`），涉及 desktop 主进程、runtime 沙箱、storage 凭据存储与构建脚本四个模块，另含 Windows 托盘与亚克力背景两项体验增强。

---

## 2. 支持的 Windows 版本

- **Windows 10 x64**
- **Windows 11 x64**

仅提供 x64 产物，未提供 arm64。Windows 7/8 及更早版本不在支持范围。

---

## 3. 已适配模块

### 3.1 权限降级
- `permission-overlay` 在 win32 下显式返回 `unsupported_platform`，避免覆盖未实现的能力（commit `41dc00aff`，`apps/desktop/src/main/permission-overlay/permission-overlay-main.ts`）。
- `os-permission-policy` / `permissions-actions` 为 win32 增加权限策略分支：`microphone` 已授权时返回 `already_granted`，否则 `open_settings`；`notifications` 返回 `open_settings`；其它权限返回 `unsupported_platform`（commit `2801860db`、修复 `a9a1eb4fc`）。
- `capability-snapshot` 新增 `canOpenSettings` 字段，反映 Windows 通知能力（commit `6129681e1`）。

### 3.2 shell-env PowerShell PATH
- `shell-env.ts` 通过 PowerShell 捕获解析 Windows PATH（+179 行），绕开 Electron 主进程在 Windows 上继承环境不完整的问题（commit `d427ba38d`）。

### 3.3 userData LocalAppData
- `boot.ts` 在 Windows 下将 `userData` 重定向到 `%LOCALAPPDATA%\Maka`，避免 roaming 同步带来的状态漂移（commit `b4ae0a588`；TS 类型回归由 `92c3e438b` 修复，改用 `process.env.LOCALAPPDATA`）。

### 3.4 沙箱降级
- `default-sandbox-manager.ts` / `sandbox-manager.ts` / `diagnostics.ts` 三处加 Windows 平台分支：沙箱不可用时返回 `unsupported_platform` 诊断而非硬失败，沙箱管理器在 win32 下走降级路径（commit `bef4a2b82`）。

### 3.5 ACL 收紧
- `credential-store.ts` 新增 `tightenWindowsAcl` + `resolveWindowsUser`，在 Windows 上以 `icacls` best-effort 将凭据文件 ACL 限制为当前用户（`/inheritance:r` + `/grant:r <user>:(OI)(CI)F`），失败不阻断启动（commit `01928fa6d`、格式化 `54b123b2b`）。

### 3.6 Tray
- `tray.ts` 新增 Windows 通知区托盘图标：左键聚焦/新建窗口，右键菜单 Show + Quit（Quit 走 `app.quit()` 以触发 `before-quit` → `AppQuitCoordinator` 清理）。仅 win32 启用，`MAKA_E2E_FIXTURE` 下跳过，macOS/Linux/fixture 不受影响（commit `5422765da`）。

### 3.7 Acrylic
- `main-window.ts` 在 win32 下设置 `BrowserWindow({ backgroundMaterial: 'acrylic', backgroundColor: '#00000000' })`（透明背景为 acrylic 合成前置条件；macOS 保留 darwin vibrancy，Linux 不变）；新增渲染层 `styles/windows-glass.css`，全部规则限定 `html[data-os=win32]`：透明 window/body、半透明侧栏面板（浅色 0.55 / 深色 0.6）、透明 footer + titlebar 让 acrylic 透出（commit `18e10085b`）。

### 3.8 运行时文件系统
- `launch-spec.ts` 补充 Windows 下 ripgrep 候选路径：Chocolatey、Git for Windows、Scoop 安装位置，提升 Windows 上的 rg 命中率（commit `8d3368219`）。

### 3.9 构建脚本与打包
- `electron-builder.config.mjs` 增加 Windows 目标（NSIS 安装包 + 便携版，x64）（commit `fe801e344`）。
- `scripts/package-windows-x64.mjs`（123 行）封装 Windows x64 打包流程（commit `ed70345b3`）。
- `scripts/verify-windows-x64.mjs`（482 行）验证 Windows x64 产物完整性（commit `4a33bccb3`）。
- `scripts/windows-x64-release.test.mjs`（124 行）覆盖打包/验证脚本的失败路径（commit `46cf4ebcb`）。
- 根 `package.json` 与 `scripts/ci-test-plan.mjs` 注册 `package:windows-x64` / `verify:windows-x64` 入口（commit `52f4fed5b`）。
- Windows 签名降级为 p12-only，移除 Azure Trusted Signing 路径（commit `e392e0a01`）。

---

## 4. 已知限制

1. **沙箱 unsupported_platform**：Windows 下运行时沙箱不支持，`sandbox-manager` 走降级路径并报告 `unsupported_platform`；工具执行不具备沙箱隔离。
2. **cua-driver 不支持**：`packages/computer-use/src/select-backend.ts` 在非 darwin 平台返回 `NONE`，Windows 下 Computer Use 后端不可用，报告 `not_available`（commit `18688729a` 文档记录）。
3. **真机冒烟未完成**：本预览为代码层面的适配与单测覆盖，未在真实 Windows 环境完成端到端冒烟（`package-windows-x64` / `verify-windows-x64` 需 Windows 环境，Linux 无法完成）。
4. **仅 x64**：构建目标仅 Windows x64，未提供 arm64 产物。
5. **权限能力受限**：部分权限动作在 Windows 下为不支持状态（`unsupported_platform`），权限覆盖层显式报告降级。
6. **ACL 收紧为尽力而为**：`icacls` 以 best-effort 方式限制凭据文件，失败不阻断启动；在未安装 PowerShell 或异常 ACL 的系统上可能降级。
7. **PATH 依赖 PowerShell**：Windows PATH 解析依赖 PowerShell 捕获，在 PowerShell 缺失或被策略限制的环境下可能退化。
8. **ripgrep 依赖外部安装**：Windows 下 ripgrep 需由 Chocolatey / Git for Windows / Scoop 提供，未内置。
9. **签名仅支持 p12**：Windows 签名链降级为仅 p12（`CSC_LINK` + `CSC_KEY_PASSWORD`），Azure Trusted Signing 路径已移除；企业 Azure 签名场景留待后续版本补齐。
10. **通知能力有限**：Windows 通知通过 `canOpenSettings` 暴露受限能力，设置面板打开路径可能不同。

---

## 5. 构建步骤

前置：Node.js >= 22.19.0，npm >= 11.12.1。

```bash
# 1. 安装依赖（含 install-electron postinstall）
npm ci

# 2. 构建所有 workspace 产物（core / storage / mcp / runtime / runtime-host /
#    computer-use / headless / cli / ui / desktop）
npm run build

# 3. 打包 Windows x64 产物（NSIS 安装包 + 便携版）
npm run package:windows-x64

# 4. （可选）验证产物完整性
npm run verify:windows-x64
```

说明：
- `package:windows-x64` 由 `scripts/package-windows-x64.mjs` 封装，调用 `electron-builder` 按 `apps/desktop/electron-builder.config.mjs` 的 win target 输出 x64 产物。
- 签名需提供 `CSC_LINK`（p12 base64）与 `CSC_KEY_PASSWORD` 环境变量；无签名密钥时脚本降级为未签名构建（草稿阶段可接受）。
- 步骤 3/4 需在 Windows 环境执行，Linux 无法生成/验证 Windows 产物。

---

## 6. 测试

```bash
# 完整测试套件（clean + build:test + scripts + workspace 并行）
npm test
```

当前基线：**1369 / 1369 tests pass**，0 失败，261 suites，duration ~29.6s（Linux x64 / Node v22.23.1 编译后 JS 测试结果）。

Windows 分支相关单测：
- `apps/desktop/src/main/__tests__/os-permission-policy.test.ts` — Windows 权限策略分支（5/5 通过）
- `apps/desktop/src/main/__tests__/shell-env.test.ts` — Windows shell-env 纯函数分支
- `scripts/windows-x64-release.test.mjs` — 打包/验证脚本失败路径（3/3 通过）
- 沙箱工作区测试：`default-sandbox-manager` / `sandbox-detect` / `sandbox-diagnostics` / `sandbox-manager` 4 个测试文件全通过
- `credential-store.test.js` 60 cases PASS

注意：1369/1369 为 Linux 侧编译后测试结果，不等于 Windows 真机运行时正确性。Windows 专属外部进程行为（`icacls`、PowerShell PATH 解析、`%LOCALAPPDATA%` 重定向、沙箱降级启动）仅代码评审 + 单测覆盖，未端到端跑通。

---

## 7. Release

本预览以 **草稿 (draft)** 形式准备 GitHub Release，不立即发布。由 Orchestrator / 发布负责人在确认后手动执行。

- 仓库：`anaconda110/maka-agent`
- 标签：`v0.1.2-win.1`
- 目标分支：`feature/windows-adapt`
- 标题：`Maka 0.1.2 Windows Preview`
- Notes：`.hive/win-release-notes.md`
- 类型：`--draft`

推荐命令（草稿，**不要直接执行**，由负责人确认后运行）：

```bash
gh release create v0.1.2-win.1 \
  --repo anaconda110/maka-agent \
  --target feature/windows-adapt \
  --title "Maka 0.1.2 Windows Preview" \
  --notes-file .hive/win-release-notes.md \
  --draft
```

前置检查清单（执行前需确认）：
1. `gh auth status` 已登录且对 `anaconda110/maka-agent` 有写权限。
2. `feature/windows-adapt` 已推送到 origin。
3. 确认 tag 命名（`v0.1.2-win.1`）符合仓库 release 规范。
4. 确认是否附加 Windows x64 构建产物（.exe / .nsis）作为 release asset；本预览未在 CI 跑通构建，**建议先发布纯 notes 草稿，不带 asset**。
5. Review `.hive/win-release-notes.md` 内容，确认"已知限制"措辞符合对外口径。

备用（不自动建 tag）：先 `git tag -a v0.1.2-win.1 -m "Maka 0.1.2 Windows Preview" feature/windows-adapt` + `git push origin v0.1.2-win.1`，再执行上述 `gh release create --draft`。

完整命令草稿见 `.hive/win-release-command.md`。

---

## 附：相关文档

- `.hive/windows-adapt-progress.md` — 适配进度汇总（各子模块 commits / 改动文件 / 剩余工作）
- `.hive/win-release-notes.md` — Release Notes 草稿（含改动清单、P1/P2 修复状态、提交列表）
- `.hive/win-release-command.md` — `gh release create` 命令草稿与前置检查
- `.hive/win-acceptance-checklist.md` — 验收清单（构建 / 权限 / 存储 / 沙箱 / Release / 未完成项）
- `.hive/win-build-verify.md` — 构建验证记录（1369/1369 tests pass）
- `.hive/win-code-review.md` — 代码审查报告（W-1 ~ W-7）
- `.hive/win-integration-status.md` — 集成状态（merge-tree / audit / 工作区构建）