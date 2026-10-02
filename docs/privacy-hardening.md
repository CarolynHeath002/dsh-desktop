# DSH Desktop 隐私加固说明（本分支）

本分支是官方 [`anywhere-labs/dsh-desktop`](https://github.com/anywhere-labs/dsh-desktop) stable（`dsh-plugin-desktop`）的隐私加固版，供个人构建使用。本文对照官方版本，说明**移除了哪些遥测与上传**、**保留了哪些数据出境**，以及构建与验证方法。

所有改动只涉及 `dsh-plugin-desktop`（stable）工作区；`dsh-plugin-desktop-beta`（beta）未同步加固，官方全量 CI 中的 `check:desktop-variants` 会因此报告两变体差异——用本文的 Windows 工作流打包不受影响。

## 一、相对官方版已移除的遥测与上传

| 路径 | 官方版行为 | 本版行为 | 实现位置 |
| --- | --- | --- | --- |
| 安装 UUID | 打包版启动 ~60s 后、每 6h 自动 `GET https://www.dshdesktop.cn/api/desktop/version`，携带持久安装 UUID（`X-DSH-Desktop-Installation-Id`）与版本/渠道头 | **不再生成、持久化或发送安装 UUID**；自动检查关闭 | `src/main.ts`（移除 `getOrCreateDesktopInstallationId` 的生成与传参） |
| 应用内更新通道 | 设置页/标题栏/托盘可手动“检查更新”，确认后下载官方安装包 | **整条通道移除**：Host 插件行 `desktop-updates` 出生即禁用，且在所有 bundle/用户层之后再次强制禁用；无自动检查、无手动入口、无安装包下载；运行时不联系 `dshdesktop.cn` | `cordis.patch.yml`（行 `disabled: true`）、`src/profile.ts`（强制禁用列表）、`src/client/desktop-settings.ts`（`capabilities.updates: false` 隐藏设置区块）、`src/client/DesktopFrameTitlebarView.tsx`（标题栏版本弹层移除检查按钮，仅保留版本号显示） |
| 会话日志随模型请求（`dsh_session_log`） | 上游 `@deepseek-ai/dsh-session-log-deepseek` 默认 `enabled: true`：每次调用官方 DeepSeek API 时，请求体附带增量规范化会话日志（≤8 MiB/次，跨请求续传），包含 system/user 消息、**全部工具调用输入/输出**、被压缩裁剪的历史、surface 事件 | **整行强制禁用**，该字段不再随任何请求离开设备 | `src/profile.ts` `PRIVACY_HARDENING_DISABLED_ROW_IDS` |
| OTel 会话遥测 | `session-telemetry-otel` 默认 `FEEDBACK_ONLY`：会话内显式提交反馈后，截至反馈点的完整会话日志前缀连同匿名 ID 上传 `https://dsh-otel-collector.deepseeksvc.com/v1/logs` | **整行强制禁用**（原版仅在设 `DSH_TELEMETRY_DISABLED` 时关闭）；提交反馈不再触发任何上传 | `src/profile.ts` 同上 |
| 产品埋点 | 上游对 `desktop` Profile 默认装载 `desktop-product-telemetry` + `product-analytics`（device_id、登录 user_id、os/app 版本、消息提交/模型切换/插件安装等交互事件 → DeepSeek 收集器）。官方 DSH Desktop 已禁用这两行 | 保持禁用，并改为**无条件 + 测试锁定**：任何 bundle、profile、用户 patch 层都无法重新启用 | `src/profile.ts` 同上；`tests/profile.spec.ts` 用例锁定 |
| DeepSeek web_search | 默认组合提供 `web-search-deepseek` 工具：模型调用时把**原始搜索词**（嵌在固定 prompt）发往所配置的 DeepSeek 端点 | **工具行与其设置页行（`ui-settings-web-search`）均强制禁用**：agent 工具列表中不再出现 web_search，搜索词不出境 | `src/profile.ts` 同上；`tests/profile.spec.ts` 用例锁定 |
| Agents Anywhere 远程控制 | opt-in 装载 `@agents-anywhere/dsh-bridge-next`：会话、时间线、附件经 `agents-anywhere.com` 或自建服务中转 | 启动器 `aaEnabled` 恒为 `false`，**bundle 永不进入组合**，进程内不存在该代码路径（历史偏好中即使开启也无效） | `src/main.ts`（`preparationHooks.aaEnabled`） |

以上强制禁用均在 `prepareDesktopProfile` 中、于全部 bundle/Profile/用户层组合完成之后追加，`rows.has(id)` 存在即压 `disabled: true`，不受 `DSH_TELEMETRY_DISABLED`、`DSH_TELEMETRY_MODE` 等环境变量影响。

## 二、仍保留的数据出境

按官方版语义不变，均为**产品功能所必需或你显式配置的结果**：

1. **模型 API 调用本身**：prompt、上下文、附件/文件内容、工具请求发往**你配置的模型端点**（官方默认 `api.deepseek.com`）。这是产品核心功能。
2. **匿名用户 ID 头**：每次 DeepSeek 请求携带 `x-deepseek-harness-user-id`（`$DSH_HOME/.anonymous-user-id` 中的 home 级随机 UUID），仅发往你的模型端点，用于把同一安装的请求关联。删除该文件即可重置。如需彻底移除须给 vendored `dsh-llm-deepseek` 打 patch（本分支未做）。
3. **你主动配置的 MCP / 工具 / 插件**的网络行为：按各服务自身条款执行。
4. **插件市场**（opt-in）：选择 1024Store / dshfind / dsh-market 等源后，目录请求（IP、固定 UA、搜索词、资源标识）发往对应源与 npm/GitHub/图床。默认不选择任何源。
5. **依赖物化**：安装/更新插件或物化 profile 依赖时，包管理器联系 npm registry、GitHub、Electron headers 等公开基础设施。均由你主动触发。

不再存在的官方联系点：移除更新通道后，本版运行时**没有任何**联系 `www.dshdesktop.cn` 或 `dsh-otel-collector.deepseeksvc.com` 的路径（相关代码仍在包内但不可达：版本检查常量无调用方、更新路由未注册）。

## 三、本地数据（与官方版一致，不上传）

- 会话、附件、凭据（`.env` / `.credentials.yaml`，0600/0700 但未加密）、日志（10 MiB 轮换、7 天清理、≤200 MiB）均保留在 `$DSH_HOME` 与 Electron userData 目录。
- Crashpad 崩溃转储仅本地（`uploadToServer: false`）。
- 诊断 ZIP 仅在你手动导出时生成，含日志/路径/会话 ID 等，分享前自行检查。

## 四、Windows 构建与分发

使用本仓库的 `.github/workflows/windows-package.yml`（手动 `workflow_dispatch` 触发）：

- 仅在 `windows-latest` 上构建 **stable（dsh-plugin-desktop）** 的 NSIS 安装包（`DSH-Desktop-<版本>-x64-Setup.exe`）与便携版 zip（`...-Portable.zip`），构建命令与官方 CI 完全一致（`check:win-package:platform` → `dist:win` → `dist:win-portable`），仅补加 `upload-artifact` 上传步骤。
- 产物未签名：首次运行会触发 SmartScreen，选择“更多信息 → 仍要运行”即可；便携版免安装、无注册表痕迹，推荐自用。
- 工作流文件需位于默认分支才能在 Actions 页面选择分支触发；加固提交必须在所选分支上。

## 五、验证清单

1. `%APPDATA%\DSH Desktop\identity\` 目录**永不出现**（安装 UUID 已整体移除）。
2. 设置页无“检查更新”区块；标题栏版本弹层无检查按钮；托盘无更新项。
3. agent 工具列表无 `web_search`；设置无 Web 搜索开关。
4. 插件页无远程控制（AA）入口。
5. 可选纵深防御：在 `C:\Windows\System32\drivers\etc\hosts` 追加
   `0.0.0.0 www.dshdesktop.cn dsh-otel-collector.deepseeksvc.com`
   即使未来版本回归，进程也无法连接这两个采集端点；不影响模型 API。
6. 出站抽查：防火墙/资源监视器中，正常使用仅应看到你配置的模型端点（及你主动使用的 MCP/市场源）连接。

## 六、实现清单与回退

改动文件（仅 `dsh-plugin-desktop` 与新增文档/工作流）：

- `src/profile.ts` — `PRIVACY_HARDENING_DISABLED_ROW_IDS`（`session-telemetry-otel`、`session-log-deepseek`、`web-search-deepseek`、`ui-settings-web-search`、`desktop-updates`、`desktop-product-telemetry`、`product-analytics`）与组合末尾的强制禁用循环
- `src/main.ts` — 安装 UUID 移除；`aaEnabled` 恒 `false`
- `cordis.patch.yml` — `desktop-updates` 行 `disabled: true`
- `src/client/desktop-settings.ts` — `capabilities: { updates: false }`
- `src/client/DesktopFrameTitlebarView.tsx`、`src/native-ui/compatibility-chrome/main.tsx` — 移除检查更新按钮
- `tests/profile.spec.ts` — 新增/强化锁定用例
- `.github/workflows/windows-package.yml` — 仅 Windows 打包工作流（新增）

回退：`git checkout` 上述 `src/`、`cordis.patch.yml`、`tests/` 文件并删除新增文件即可恢复官方行为。
