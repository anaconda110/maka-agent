# Android 服务层占位实现状态

- 分支：`feature/android-rn`
- 验证日期：2026-08-03
- Dispatch：c0b42af6-84c4-4802-8629-6670fcfbe49c

## 1. 服务目录清单

`apps/mobile-rn/src/services/` 当前文件：

| 文件 | 行数 | 状态 | 说明 |
|---|---|---|---|
| `RuntimeHostClient.ts` | 34 | 🟡 占位 | 仅类型定义 + 空实现（`connect/disconnect/isConnected`） |
| `keychainStorage.ts` | 21 | ✅ 已实现 | `react-native-keychain` 封装，`saveApiKey/loadApiKey/clearApiKey` 可用 |
| `index.ts` | 2 | ✅ 导出桶 | 仅 re-export `RuntimeHostClient`（未导出 `keychainStorage`） |

## 2. 任务要求的四个服务占位状态

任务要求确认 `RuntimeHostClient.ts`、`model-connection.ts`、`session-store.ts`、`credential-store.ts` 的占位状态。实际清查结果：

| 预期文件（架构规划） | 实际路径 | 现状 | 完成度 |
|---|---|---|---|
| `RuntimeHostClient.ts` | `src/services/RuntimeHostClient.ts` | **存在占位** | 34 行骨架，`connect` 仅置 `connected=true`，`disconnect` 置 `false`，无 WebSocket 握手、无请求/响应、无协议帧。注释明确指向 `.hive/android-rn-architecture.md §4.2` 的 M1 实现计划 |
| `model-connection.ts` | `src/services/model-connection.ts` | **缺失（未创建）** | 0% — 架构规划为 M1 新增（`architecture.md:95`），尚未动工。预期承载 LLM 连接配置 + 模型列表拉取 + 流式请求 |
| `session-store.ts` | `src/store/session-store.ts` | **缺失（未创建）** | 0% — 架构规划为 M2 从 `appStore.ts` 拆分（`architecture.md:96`）。当前会话状态全部塞在单文件 `src/store/appStore.ts`（130 行，含 `sessions/currentSessionId/messages` + LLM 配置 + runtime 状态） |
| `credential-store.ts` | `src/services/credential-store.ts` | **缺失（未创建）** | 0% — 架构规划为 M1 新增（`architecture.md:97`）。当前凭证存储功能由 `keychainStorage.ts` 临时承担（仅 `apiKey` 一个字段），尚未扩展为通用 credential store |

## 3. 各服务完成度详评

### 3.1 `RuntimeHostClient.ts` — 占位（~10%）
- ✅ 已定义 `RuntimeHostEndpoint`、`RuntimeHostClient` 接口签名（与 `architecture.md:171` 预期接口对齐）
- ✅ 工厂函数 `createRuntimeHostClient()` 返回符合接口的桩对象
- ❌ `connect()` 无 WebSocket 建立、无 `MobileFramedTransport` 帧封装、无握手
- ❌ 无 `request/response`、无 `subscription.open` 增量流通道
- ❌ 无错误处理 / 重连 / 超时
- 接入计划：M1 阶段重写为 `MobileRuntimeHostClient`（见 §4）

### 3.2 `model-connection.ts` — 未创建（0%）
- 预期职责：LLM 模型连接（OpenAI 兼容 HTTP），`apiBaseUrl/apiKey/model` 注入、模型列表拉取、流式 chat completion
- 现状：`appStore.ts` 中仅持有 `LlmConnectionConfig` 静态字段，无任何网络请求代码
- 接入计划：M1 新增，复用桌面端 `@maka/client` 的 HTTP 流式实现思路，剥离 Node 依赖

### 3.3 `session-store.ts` — 未创建（0%）
- 预期职责：从 `appStore.ts` 拆出会话/消息 slice，配合 `subscription.open` 增量更新
- 现状：会话与消息状态混在 `appStore.ts`（`sessions/currentSessionId/messages` 字段 + `createSession/deleteSession/setCurrentSession/appendMessage` 动作）
- 接入计划：M2 拆分，先抽出 `sessionStore`，再接 runtime 增量订阅

### 3.4 `credential-store.ts` — 未创建（0%）
- 预期职责：通用凭证存储（apiKey / runtime token / 多账户），基于 `react-native-keychain`
- 现状：`keychainStorage.ts` 仅提供 `apiKey` 单字段 CRUD（service=`maka.mobile.llm`），已被 `appStore.ts` 调用
- 接入计划：M1 扩展为 `credential-store.ts`，保留 `keychainStorage.ts` 作为底层封装或合并

## 4. 后续接入计划（按架构里程碑）

| 里程碑 | 模块 | 涉及服务文件 | 优先级 |
|---|---|---|---|
| **M1** | Runtime Host 连接层 | `MobileFramedTransport`（新增 `src/services/framed-transport.ts`）、`RuntimeHostClient.ts`（重写为 `MobileRuntimeHostClient`，WebSocket 握手 + 请求）、`credential-store.ts`（新增，扩展 keychain）、`model-connection.ts`（新增，LLM HTTP 流式） | P0 |
| **M2** | 真实 Chat / Home UI + 会话订阅 | `session-store.ts`（从 `appStore.ts` 拆分）、`subscription.open` 增量流接入、`react-native-permissions` | P1 |
| **M4** | SQLite 投影（可选） | `src/services/sqlite/*.ts`（新增） | P2 |

## 5. 风险与注意事项

- `services/index.ts` 未导出 `keychainStorage`，外部通过相对路径 `../services/keychainStorage` 引入（`appStore.ts:4`），后续重构需统一导出
- `RuntimeHostClient.ts` 接口签名已与架构文档对齐，M1 重写时应保持接口兼容，避免破坏 `services/index.ts` 的 re-export
- `appStore.ts` 中 `partialize` 明确不持久化 `apiKey`（`appStore.ts:122-126`），与 keychain 双层存储策略一致，M1 扩展 `credential-store` 时需保持该策略
- 三个未创建文件（`model-connection.ts`/`session-store.ts`/`credential-store.ts`）均属架构规划而非遗漏，当前分支聚焦于 Android 原生构建 + UI 脚手架，服务层留待 M1/M2

## 6. 结论

Android 服务层当前为**脚手架阶段**：仅 `RuntimeHostClient.ts`（占位骨架）与 `keychainStorage.ts`（可用）落地，架构规划的 `model-connection.ts`、`session-store.ts`、`credential-store.ts` 均未创建，符合 M0 脚手架里程碑预期。真实服务层实现将在 M1（连接层 + LLM 接入）和 M2（会话订阅 + store 拆分）阶段推进。