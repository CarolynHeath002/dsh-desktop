# Privacy hardening (fork divergences from upstream)

This repository tracks `deepseek-ai/deepseek-harness` `master` on the `hardened` branch. The
divergences below are the fork's entire patch surface; everything else is upstream code. Keep each
divergence minimal so upstream merges stay small.

中文说明见下方「隐私加固说明」。

## Divergences

1. **Final-layer egress row disable** (`packages/boot/app-boot/src/profile-context.ts`).
   `readProfilePatches()` appends a final `disabled: true` patch for every egress row of a mounted
   bundle: `session-log-deepseek`, `session-telemetry-otel`, `web-search-deepseek`, `web-deepseek-api`
   (`@deepseek-ai/dsh-base`), and `desktop-product-telemetry`, `product-analytics`,
   `ui-settings-web-search` (`@deepseek-ai/dsh-web-app`). No profile, home, or overlay layer can
   re-enable them; HMR recomposition, the config editor, and the worker runtime re-run the same seam.
   A mounted bundle whose hardened rows do not all compose throws with the missing ids, so an upstream
   row move fails loud at boot. `DSH_TELEMETRY_DISABLED` stays accepted but is no longer required.
2. **Update channel fails closed** (`apps/desktop/src/update-coordinator.ts`). The coordinator's
   default `enabled` gate is a constant `false`: no feed poll, download, or install can reach
   `download.deepseek.com`. The "Check for Updates" menu item stays and reports the existing
   "no packaged update source" failure. Upstream publish/upload tooling under `apps/desktop/scripts/`
   is untouched (build-time only).
3. **Mandatory-policy channel is dead-air** (`apps/desktop/presets/test.env`). Packaging requires a
   mandatory-policy origin; the fork seals `https://dsh-policy.invalid` (RFC 2606 reserved name). The
   poller never sends a payload: DNS NXDOMAIN precedes any HTTP byte. Same for the sealed update feed
   origin `https://dsh-update.invalid` as defense in depth behind divergence 2.
4. **Packaging and release run on GitHub-hosted runners** (`.github/workflows/windows-package.yml`).
   Upstream routes this workflow to its self-hosted `dsh-win-package-trial` label; the fork builds
   unsigned on `windows-latest` with `source_ref` defaulting to `hardened`. A `publish_release`
   input gates a `publish` job that turns the retained build into a GitHub Release (tag
   `v<version>`; unsigned builds are marked prerelease), and the package job runs only on
   `workflow_dispatch` so modified-workflow pushes cannot trigger the pipeline.

## Kept as upstream

`platform.deepseek.com` sign-in, top-up, and usage pages (user-initiated); the model and tool
channels (user-configured endpoints); crash reports and the update journal (local files); loopback
Host IPC. Main-process `track()` relays analytics through the Host's product-analytics row, which
divergence 1 disables; the relay's failure path leaves `analyticsEnabled` false.

## Re-verify after every upstream merge

1. The seven row ids above still exist in
   `packages/bundle/base/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`; update
   `PRIVACY_HARDENING_ROW_FAMILIES` when upstream moves a row (the boot-time tripwire names it).
2. New base/web-app rows with network behavior: audit `cordis.patch.yml` diffs for new row ids and
   extend the families list.
3. `apps/desktop/src/update-coordinator.ts` still carries the constant-false gate; re-apply if
   upstream refactors the constructor.
4. The preset origins in `apps/desktop/presets/test.env` remain reserved names, and
   `validateDesktopPackageEnvironment` still accepts them.
5. Run the egress check against a packaged build: no contact with `dsh-otel-collector.deepseeksvc.com`,
   `download.deepseek.com`, or `api.deepseek.com/v1/tools/*`.
6. The packaging workflow keeps the `workflow_dispatch` guard, the `publish` job stays scoped to
   `contents: write` + `actions: read`, and unsigned releases stay prerelease-marked.

---

# 隐私加固说明（fork 相对上游的全部分歧）

本仓库在 `hardened` 分支上跟踪 `deepseek-ai/deepseek-harness` 的 `master`。以下即为 fork 的全部补丁面，其余都是上游代码。保持每项分歧最小，让上游合并尽量无冲突。

## 分歧清单

1. **末层强制禁用出境行**（`packages/boot/app-boot/src/profile-context.ts`）。`readProfilePatches()` 为已挂载 bundle 的每个出境行追加最终 `disabled: true` patch：base 的 `session-log-deepseek`、`session-telemetry-otel`、`web-search-deepseek`、`web-deepseek-api`；web-app 的 `desktop-product-telemetry`、`product-analytics`、`ui-settings-web-search`。任何 profile、home 或 overlay 层都无法重新启用；HMR 重组合、配置编辑器与 worker 运行时都经过同一条缝。已挂载 bundle 的加固行未全部组合时抛错并列出缺失 id，上游移动行会在启动时显式失败。`DSH_TELEMETRY_DISABLED` 仍被接受，但加固不再依赖它。
2. **更新通道常闭**（`apps/desktop/src/update-coordinator.ts`）。协调器默认 `enabled` 闸门为常量 `false`：任何 feed 轮询、下载、安装都到不了 `download.deepseek.com`。"检查更新"菜单保留，并复用既有"无打包更新源"失败路径。上游 `apps/desktop/scripts/` 下的发布/上传工具不动（仅构建期使用）。
3. **强制更新策略通道为死端**（`apps/desktop/presets/test.env`）。打包要求策略 origin；fork 封存 `https://dsh-policy.invalid`（RFC 2606 保留名）。轮询发不出任何载荷：DNS NXDOMAIN 先于任何 HTTP 字节。封存的更新源 `https://dsh-update.invalid` 同理，作为分歧 2 之后的纵深防御。
4. **打包与发布在 GitHub 托管 runner 上进行**（`.github/workflows/windows-package.yml`）。上游将该工作流路由到其自托管 `dsh-win-package-trial` 标签；fork 在 `windows-latest` 上出未签名包，`source_ref` 默认 `hardened`。`publish_release` 输入开启的 `publish` job 会把保留产物发布为 GitHub Release（tag `v<版本号>`，未签名构建标记 prerelease）；package job 仅在 `workflow_dispatch` 时运行，修改工作流文件的 push 不会触发流水线。

## 保持上游原样

`platform.deepseek.com` 登录、充值、用量页（用户主动触发）；模型与工具通道（用户配置的端点）；崩溃报告与更新日志（本地文件）；loopback Host IPC。主进程 `track()` 经 Host 的 product-analytics 行转发分析事件，分歧 1 已禁用该行，转发失败路径使 `analyticsEnabled` 保持 false。

## 每次上游合并后复检

1. 上述七行仍存在于 `packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml`；上游移动行时更新 `PRIVACY_HARDENING_ROW_FAMILIES`（启动 tripwire 会指名）。
2. base/web-app 中有网络行为的新行：审计 `cordis.patch.yml` diff 中的新行 id，并扩大家族清单。
3. `apps/desktop/src/update-coordinator.ts` 仍带常闭闸门；上游重构构造器后重新套用。
4. `apps/desktop/presets/test.env` 的 origin 仍为保留名，且 `validateDesktopPackageEnvironment` 仍接受它们。
5. 对打包产物做出境检查：不出现对 `dsh-otel-collector.deepseeksvc.com`、`download.deepseek.com`、`api.deepseek.com/v1/tools/*` 的连接。
6. 打包工作流保留 `workflow_dispatch` 守卫；`publish` job 权限仍限于 `contents: write` + `actions: read`；未签名 Release 保持 prerelease 标记。
