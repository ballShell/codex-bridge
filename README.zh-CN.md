# Codex Bridge

[English](README.md) | **简体中文**

**前店后厂的双模型协作插件**：把 OpenAI Codex CLI 封装为 Antigravity 2.0 的可控 Subagent，并附带嵌入式右侧 **像素龙 Codex Monitor** 实时看板。

- **前店（Antigravity / Gemini）**：发挥“会说人话”的优势，负责需求对话、追问澄清、把模糊想法翻译为结构化工程任务书，并在执行后做结果验收与人话汇报。
- **后厂（Codex CLI）**：专注复杂仓库架构设计、后端实现、多文件重构与只读代码审查——支持复杂任务「先只读出方案、确认后再落盘」（`codex_plan` → `codex_run`），也支持日常任务随调随用（`codex_review`、`codex_run`）。
- **像素龙工坊看板（Codex Monitor）**：在 Antigravity 右侧边栏按**当前会话（及子代理树）独立**展示所有派出的 Codex 状态、模型与思考强度标签、Token 与缓存统计、剩余预算倒计时以及智能报错摘要。

## 像素龙工坊一览

每个派出干活的 Codex 都会化身一只 6 态像素龙，随任务阶段实时切换动态演出：

| 闲置待命 | 思考规划 | 编码执行 | 代码审查 | 任务完成 | 异常中断 |
| :---: | :---: | :---: | :---: | :---: | :---: |
| ![闲置](sidecars/codex_monitor/assets/dragon/idle.gif) | ![思考](sidecars/codex_monitor/assets/dragon/thinking.gif) | ![编码](sidecars/codex_monitor/assets/dragon/coding.gif) | ![审查](sidecars/codex_monitor/assets/dragon/reviewing.gif) | ![完成](sidecars/codex_monitor/assets/dragon/completed.gif) | ![异常](sidecars/codex_monitor/assets/dragon/failed.gif) |
| 静待派单 | 深度规划推理 | 编码与执行命令 | 逐行审查改动 | 圆满完成任务 | 执行出错或超时 |

## 最新特性

- **插件级默认模型轻量隔离**：可在 **Codex Monitor** 右侧看板直接下拉切换 Codex 目录支持的所有模型作为本插件默认模型（保存在 `${PLUGIN_DATA}/settings.json`，不改动用户的 `~/.codex/config.toml`），随时可切回「跟随 Codex」。
- **软硬双层执行时长约束**：`codex_plan` / `codex_run` / `codex_review` 全面支持 `max_duration_seconds`（~80% 自动注入软时间预算指令 + 硬超时进程树强杀）与可选 `max_idle_seconds` 静默看门狗，卡片上实时显示剩余倒计时与软/硬预算明细。
- **结构化看板与报错清洗**：清爽的 2×2 工作量统计（运行中/总任务、缓存命中率、平均耗时、改动文件与通过率），展开卡片即可查看 Token 四维拆分、预算条，以及自动剥离原始 HTML / 重连噪声的错误摘要卡片（完整原始日志一键折叠查看）。
- **Lazy MCP 按需加载**：仅 `codex_status` 常驻 eager，其余重型工具（`codex_plan`、`codex_run`、`codex_review`、`codex_poll`）按需加载，不挤占主对话上下文。
- **跨进程共享锁与安全落盘**：Python 与 Node.js 共用同一套原子锁目录协议（`scripts/file_lock.py` + `scripts/file_lock.mjs`），支持死进程锁回收与 Windows 占用退避重试，保障 `tasks.json`、`settings.json`、`pending_calls.jsonl` 并发读写安全。

## 平台与运行环境支持

| 维度 | 支持目标 | 支持状态与说明 |
| :--- | :--- | :--- |
| **宿主环境** | **Antigravity 2.0 桌面版** | 主力适配目标（覆盖 MCP Server、`PreToolUse` Hook、侧栏 Sidecar 及 `codex-worker` 子代理）。 |
| **运行依赖** | **Node.js 18+** 与 **Python 3.9+** | Python 零三方包依赖。MCP 与 Hook 统一由 Node.js 启动（`launch_mcp.mjs`、`codex_hook.mjs`），跨平台行为一致。 |
| **macOS** | **Intel 与 Apple Silicon** | 已完成端到端实测。针对桌面 GUI 精简 `PATH`，自动补扫 Homebrew（`/opt/homebrew/bin`、`/usr/local/bin`）、`nvm`、`fnm`、`volta`、`mise`、`asdf`、`npm-global`、`bun` 中的 `codex`。 |
| **Windows** | **Windows 10/11（cmd / PowerShell）** | 已完成全量跨平台适配并通过自动化单测覆盖 *（建议在真实 Windows 桌面做一次实机冒烟）*：通过 `launch_mcp.mjs` 自动探测 `py -3` / 真 Python 3.9+ 并跳过微软商店 `python3.exe` 占位符；安全解析 npm `.cmd`/`.bat` shim 为 `[node, <cli.js>]` 避免 `cmd.exe` 参数注入；强制 UTF-8 stdio（兼容中文 CP936/GBK）；使用 `CREATE_NEW_PROCESS_GROUP` + `taskkill /T /F` 清理后代进程树，并在文件锁占用时退避重试原子替换。 |
| **Codex 认证** | `codex login` / API Key / 自定义中转 | 支持 OAuth 登录、`OPENAI_API_KEY`，以及 `$CODEX_HOME/config.toml` 自定义 `model_provider` 与 `model_catalog_json`。 |

## 安装

方式一：通过 Antigravity CLI 直接安装

```bash
agy plugin install https://github.com/ballShell/codex-bridge
```

方式二：克隆到 Antigravity 全局插件目录（macOS / Linux）

```bash
git clone https://github.com/ballShell/codex-bridge.git ~/.gemini/config/plugins/codex-bridge
```

Windows PowerShell：

```powershell
git clone https://github.com/ballShell/codex-bridge.git "$env:USERPROFILE\.gemini\config\plugins\codex-bridge"
```

## 常用环境变量

| 环境变量 | 说明 |
| :--- | :--- |
| `CODEX_BIN` | 手动指定 `codex` 可执行文件路径或命令名（优先级最高）。 |
| `CODEX_BRIDGE_PYTHON` | 手动指定供 `scripts/launch_mcp.mjs` 使用的 Python 3.9+ 解释器（或 Windows `py` 启动器）。 |
| `CODEX_BRIDGE_DEFAULT_MODEL` | 当看板未单独固定模型（`${PLUGIN_DATA}/settings.json`）时的兜底默认模型。 |
| `CODEX_BRIDGE_DATA_DIR` | 自定义插件状态数据目录（`tasks/`、`settings.json`、`pending_calls.jsonl`）。 |
| `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX` | 设为 `1` 才允许开启 `danger-full-access`（默认关闭）。 |
| `CODEX_HOME` | 自定义 Codex CLI 配置目录（默认 `~/.codex` / `%USERPROFILE%\.codex`）。 |

## 开源协议

基于 [MIT License](LICENSE) 开源。
