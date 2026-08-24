# 调研：面向角色的 Subagent 能力与上下文注入

> 调研日期：2026-08-21  
> 范围：Pi、Anthropic Claude Code、OpenAI Codex、Google Gemini CLI、Agent Skills 与 MCP 的官方文档/源码。  
> 说明：本文把可由一手资料直接确认的内容标为“**已验证事实**”，把跨产品推论标为“**综合判断**”，把本项目可采取的方向标为“**建议**”。没有官方依据的行为明确标为“**未确认**”。
>
> **设计更新：** 本文记录了方案形成前的研究背景，正文保留了当时的仓库审计和已被否决的候选方案，不是当前实现说明。最终产品不再以四个公开 Role Skill 作为语义源；角色身份现在来自 Main Skill 内部不可变的 canonical Role Contract，专业 Skill 仅作为用户可配置能力。当前事实以 `README.md`、`docs/acceptance-report.md` 和 `docs/design/single-main-skill-role-capability-injection.md` 为准。

## 摘要

业界已经形成一条清晰但尚未标准化的分层路径：

1. **Agent profile 决定角色运行边界**：system/developer instructions、模型、工具 allowlist/denylist、MCP、权限模式、轮数和工作区隔离；
2. **Skill 提供可移植的按需知识与流程**：标准只定义 `SKILL.md`、资源目录和渐进披露，并不定义“哪个 Agent 必须加载哪些 Skill”；
3. **Plugin / Extension / Package 负责安装和注册能力**：通常是宿主或项目作用域，不天然等于单个 Subagent 的最小能力集；
4. **MCP 提供工具、资源、Prompt 和能力协商协议**：角色到 MCP server/tool 的绑定仍由宿主实现；
5. **宿主运行时负责真正隔离与审计**：Prompt 中写“只读”不是沙箱。Claude Code、Codex 和 Gemini CLI 都提供不同程度的 per-agent 工具/MCP 配置；Claude Code 还直接支持 per-agent Skill 预加载和 worktree 隔离。

对本仓库重构前的版本而言，`agent-profiles.yaml` 已经表达了较好的**宿主无关意图**，`role-task-packet.md` 也符合“最小上下文包”原则；但它们只是 advisory 数据与 Prompt 约定。Main 通过宿主原生 Subagent 能力进行 prompt-only dispatch 时，不能仅凭 `capabilities.prohibited` 或 `write_scope` 声称已经强制隔离。最稳妥的演进不是重建工作流运行时，而是增加薄的、可选的宿主适配：把同一角色意图映射到 Claude/Codex/Gemini/Pi 的原生 Agent 配置，并在每次委派报告实际生效的工具、Skill、MCP、隔离和来源。

Pi 生态里已经有一个与本问题高度同构的现成实现：`pi-subagents` 的 Agent Profile 支持 `skills`、私有 `skillPath`、`inheritSkills`、严格工具 allowlist、`extensions` 和仅在该子 Agent 中加载的 `subagentOnlyExtensions`。这意味着本项目在 Pi 上无需重新发明 capability loader；更合适的做法是把 Development、Product Test 等 canonical role 映射为 `pi-subagents` 项目 Agent，并把 Pi package 保留为安装/分发单元。

## 1. 问题拆解与评价维度

本文所说的“面向角色注入”至少包含六层，不能混为一个 Prompt：

| 层 | 典型内容 | 需要回答的问题 |
| --- | --- | --- |
| 角色指令 | system/developer prompt、职责、返回格式 | 是替换宿主 Prompt，还是追加？是否继承父会话？ |
| Skill | 领域知识、流程、参考资料、脚本 | 是启动时预加载、按需发现，还是不可用？ |
| 工具与集成 | 内置工具、扩展工具、MCP server/tool | 是 allowlist、denylist，还是只写在 Prompt 中？ |
| 材料与上下文 | 父会话、项目规则、文件、diff、前序结论 | 默认继承哪些？可否只传最小任务包？ |
| 执行隔离 | 独立 context、进程、sandbox、worktree、权限 | 隔离的是 Token、工具、文件系统还是全部？ |
| 运行证据 | thread、tool call、usage、hook/trace、来源 | 用户能否看到 Agent 实际用了什么、从哪里加载？ |

## 2. 跨产品结论矩阵

| 产品/规范 | Per-agent Skill | Per-agent 工具/MCP | 上下文与材料 | 配置范围/优先级 | 隔离 | 可观测性 |
| --- | --- | --- | --- | --- | --- | --- |
| **Claude Code** | **直接支持**：Agent `skills` 启动时注入完整 Skill；未列出的可通过 `Skill` 工具按需调用 | `tools`、`disallowedTools`、`mcpServers`、`permissionMode`、hooks | 独立 context；自定义 Agent 加载项目记忆；可传任务、恢复/追问 | managed > CLI `--agents` > project > user > plugin | 独立 context；可选 `isolation: worktree`；权限继承/覆盖有明确规则 | transcript/task UI；SubagentStart/Stop、Pre/PostToolUse hooks、debug log |
| **OpenAI Codex** | **间接支持**：自定义 Agent 是完整 config layer，可设置 `skills.config`；未见“Skill 名称数组预加载”官方字段 | Agent TOML 可设置 `sandbox_mode`、`mcp_servers` 等 config key | 独立 agent thread；主线程收集摘要；父模型/推理/运行时配置有继承规则 | CLI > 逐层 project > profile > user > system > defaults；Agent 文件再作为 spawned session layer | 子 Agent 继承当前 sandbox/approval；Agent 可设更窄 sandbox，但父 turn 的 live override 会重应用 | CLI `/agent`、App/IDE 子线程面板、每个 thread 可检查/steer/stop |
| **Gemini CLI** | **未确认有 Agent 级 Skill 列表**；Skill 是会话发现并经 `activate_skill` 同意后注入 | Agent `tools`、inline `mcpServers`，Policy Engine 可按 `subagent` 匹配 | 独立 context loop；Agent Markdown body 是 system prompt | Agent 有 user/project 文件及 `settings.json` overrides；Skill 有明确 built-in < extension < user < workspace | 工具/MCP 集合隔离；禁止 Subagent 再调用 Subagent；未见自定义 Agent worktree 字段 | `/agents` 管理；官方页面未完整说明逐 Agent transcript/usage 导出 |
| **Pi + pi-subagents** | `skills` 精确选择；`skillPath` 提供 invocation-private Skill；`inheritSkills` 控制 ambient catalog | 严格 `tools` allowlist；`extensions` 过滤；`subagentOnlyExtensions` 仅在指定 child session 加载 | fresh/fork context；可控制项目指令和 Skill 继承；Agent body 定义角色 Prompt | project Agent > user Agent > builtin；project settings/overrides > user；Pi package 另负责安装与资源过滤 | 独立 child session；支持显式 worktree；能力仍受父级 ceiling/sandbox 限制 | run/status、resolved model/context、tool/token/elapsed、artifact 与 extension acknowledgement |
| **Agent Skills** | 定义 Skill 本身，不定义 Agent 绑定 | `allowed-tools` 是实验字段且客户端支持可不同 | 三层渐进披露：metadata → SKILL.md → resources | 不规定产品发现位置或同名优先级 | 不规定 sandbox | 提供静态验证参考实现，不规定 runtime trace |
| **MCP** | 不定义 Skill | 标准化 resources/prompts/tools 与能力协商 | Server 可提供资源与 Prompt | 不定义角色到 server 的配置优先级 | 协议本身不能强制宿主隔离 | 支持 progress、cancellation、error、logging，但宿主负责呈现和审计 |

## 3. 平台事实

### 3.1 Pi：核心 Package 负责分发，pi-subagents 已提供角色级能力选择

#### 已验证事实：Pi 核心

- Pi 的 Skill 发现来自 global、project、package、settings 与 CLI；项目 Skill 只在项目受信任后加载。启动时只把 Skill 名称和描述放入 system prompt，匹配后再读取完整 `SKILL.md`，即标准的渐进披露。[Pi Skills](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- Pi Extension 可注册工具、拦截/修改 tool call、在 `before_agent_start` 注入 message 或改 system prompt，并可通过 `getActiveTools` / `setActiveTools` 动态调整当前工具集合。Extension 和 Package 拥有完整系统权限，因此只应安装可信来源。[Pi Extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- Package 可组合 extensions、skills、prompts、themes，并按资源类型过滤；同一 Package 同时存在于 global/project 时由项目设置覆盖或缩窄。npm version 与 Git ref 可固定，项目 package 只在项目受信任后自动安装。[Pi Packages](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- 因此 Pi 核心的 package 是**安装与资源发现单元**，不是“某个角色私有加载”的声明。仅把 package 名写进角色 Prompt 不会让它只出现在该 child session。

#### 已验证事实：pi-subagents

- `pi-subagents` 是独立 Pi package，不是 Pi 核心 Agent Profile 标准；它发现 `~/.pi/agent/agents/**/*.md`、`.pi/agents/**/*.md` 和兼容的 `.agents/**/*.md`，按 project > user > builtin 决议同名 Agent。[pi-subagents Agents](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md)
- Agent Profile 支持 `skills` 精确选择 child 获得的 Skill；`skillPath` 增加相对 Agent 文件解析的 invocation-private Skill 文件或目录，这些候选不会进入 parent/global catalog；`inheritSkills` 控制是否继承 Pi 已发现的 ambient Skill catalog。[pi-subagents Agents: Prompt assembly and frontmatter](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md#prompt-assembly)
- `tools` 是严格的 child allowlist，但不会自行加载 extension provider；`extensions` 可限制正常 extension 集合，`subagentOnlyExtensions` 指定只在该 Agent 的 child session 中加载的 extension path，其工具不会因此暴露给 Main。[pi-subagents Agents: Frontmatter reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md#frontmatter-reference)
- `systemPromptMode`、`inheritProjectContext`、`defaultContext` 分别控制角色 Prompt 合并、项目指令继承和 fresh/fork 默认；项目和用户 `agentOverrides` 可覆盖 `skills`、`tools`、`extensions`、模型等字段，项目配置优先。[pi-subagents Agents](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md)
- `package` frontmatter 字段只是 Agent runtime name 的命名空间，例如 `package: engineering-team` + `name: development` 注册为 `engineering-team.development`；它不是 Pi package selector。[pi-subagents Agents: Frontmatter reference](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md#frontmatter-reference)
- 运行时可报告 resolved Agent/model/context、工具与 token 计数、artifact；worktree 是独立 launch 能力。外部 CLI/job Agent 不支持 Pi Skills/Extensions，这是必须显式暴露的降级边界。[pi-subagents Execution controls](https://github.com/nicobailon/pi-subagents/blob/main/skills/pi-subagents/references/execution-controls.md)

#### 与本问题的直接对应

Pi 用户可以先用项目 `.pi/settings.json` 安装并过滤 package，再用项目 Agent Profile 选择该 package 提供的具体 Skill/extension：

```yaml
# .pi/agents/development.md
---
name: development
package: engineering-team
inheritSkills: false
skills:
  - develop-work-item
  - acme-typescript-development
skillPath:
  - ../shared-role-skills
extensions: []
subagentOnlyExtensions:
  - ./tools/dev-only.ts
tools: read, grep, find, ls, bash, edit, write
---

Own the focused Development responsibility assigned by Main.
```

Product Test 可用另一个 Profile 选择不同 Skill、只读工具和 test-only extension。该设计已经解决“同一 Pi 项目中不同 Agent 注入不同职能能力”的核心问题；本仓库需要的是角色到 native Agent name 的绑定、配置生成/检查和兼容降级，而不是再实现一套 loader。

#### 边界

- `subagentOnlyExtensions` 接受本地 extension path，不等价于“为 child 单独执行 `pi install package`”；package 仍应在 setup 阶段安装、固定版本并经过信任。
- `tools` allowlist 不能约束已允许 `bash` 内部的任意文件操作；真正只读仍需要 sandbox、worktree、capability ceiling 或宿主权限策略。
- `skills` 解决“选择与注入”，但 Skill 本身仍是主动 Prompt/脚本内容；来源冲突、版本和 digest 需要额外 provenance/doctor。
- 该能力依赖 `pi-subagents` package，不能作为所有 Pi delegate implementation 都具备的核心保证。

### 3.2 Anthropic Claude Code：目前最完整的显式 per-agent 注入模型

#### 已验证事实

- 自定义 Subagent 运行在独立 context window，拥有自定义 system prompt、特定工具和独立 permissions；结束后向父 Agent 返回结果。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- Agent 文件支持 `tools`/`disallowedTools`、`model`、`permissionMode`、`maxTurns`、`skills`、`mcpServers`、`hooks`、`memory`、`effort`、`background` 与 `isolation`。正文成为 Subagent system prompt；Subagent 只收到该 Prompt 和 cwd 等基础环境，而不是完整 Claude Code system prompt。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)
- `skills` 会在启动时注入每个 Skill 的**完整内容**，不是只有 description。该字段只控制预加载，不是可访问 Skill 的 allowlist；只要保留 `Skill` 工具，Agent 仍可发现/调用未列出的 project/user/plugin Skills。要禁止调用 Skill，必须移除或 deny `Skill` 工具。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents)
- Agent 可用 inline `mcpServers` 获得只属于该 Agent 的 server；父对话不必加载这些工具描述。项目 Agent 中的 inline server 在 Agent 文件所在目录获得独立 trust 后才加载，并仍受 managed MCP policy、strict config 等上层限制。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent)
- `isolation: worktree` 让 Subagent 在临时 Git worktree 中执行；Claude Code 对命令 cwd 和若干重定向方式做隔离检查。没有该字段时，独立 context 不代表独立 checkout。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#write-subagent-files)
- Agent 定义同名优先级为 managed settings > `--agents` > project > user > plugin；项目内嵌套目录以最接近 cwd 的定义为准。Plugin Agent 具有命名空间，但出于安全原因不支持自身的 hooks、`mcpServers`、`permissionMode`，这些字段会被忽略。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope)
- Skill 层级优先级与 Agent 不同：enterprise > personal > project；Plugin Skill 使用 namespace。Skill 被调用后，渲染内容作为 message 留在会话中；权限型 `allowed-tools` 仅在调用该 Skill 的当前 turn 生效。[Claude Code Skills](https://code.claude.com/docs/en/skills#where-skills-live) · [Skill content lifecycle](https://code.claude.com/docs/en/skills#skill-content-lifecycle)
- Skill 可用 `context: fork` 在没有父 conversation history 的 forked Subagent 中运行，并可选择 `agent` 类型；这是一条“Skill 选择 Agent”的反向绑定路径。[Claude Code Skills](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent)
- Subagent 生命周期及工具调用可由 `SubagentStart`/`SubagentStop`、`PreToolUse`/`PostToolUse` hooks 观察或阻断；委派在 transcript 中显示为 Agent tool call，后台任务可查看 transcript。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#define-hooks-for-subagents)

#### 信任注意事项

- `allowed-tools` 是临时预批准，不是工具 allowlist；Claude 官方明确指出 project Skill 可借该字段授予广泛访问，因此运行仓库 Skill 前应审阅它。[Claude Code Skills](https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill)
- 父会话处于 `bypassPermissions`、`acceptEdits` 或 auto mode 时，某些父权限会优先于 Agent frontmatter；所以只检查 Agent 文件不足以复现实际权限。[Claude Code Subagents](https://code.claude.com/docs/en/sub-agents#permission-modes)

### 3.3 OpenAI Codex：以 spawned-session config layer 表达 Agent 能力

#### 已验证事实

- Codex Subagent 运行在独立 agent thread；主线程收集结果。CLI 可用 `/agent` 检查/切换 thread，App/IDE 可打开各 Subagent thread、查看状态并停止；官方建议并行优先用于探索、测试、triage、总结，对并行写入保持谨慎。[Codex Subagents](https://developers.openai.com/codex/subagents)
- 自定义 Agent 放在 `~/.codex/agents/*.toml` 或 `.codex/agents/*.toml`，必需字段为 `name`、`description`、`developer_instructions`。它是 spawned session 的完整 config layer，可设置 `model`、`model_reasoning_effort`、`sandbox_mode`、`mcp_servers`、`skills.config` 等普通 `config.toml` key；遗漏项从父会话继承。[Codex Subagents](https://developers.openai.com/codex/subagents#custom-agents)
- 子 Agent 默认继承父模型和 reasoning；显式 spawn、`[agents]` 默认和 Agent 文件存在分层解析。自定义 Agent 文件中的 `model`/`model_reasoning_effort` 最终优先；父 turn 的 live sandbox/approval override 会在 spawn 时重新应用，即使 Agent 文件写了不同默认值。[Codex Subagents](https://developers.openai.com/codex/subagents#choosing-models-and-reasoning) · [Approvals and sandbox controls](https://developers.openai.com/codex/subagents#approvals-and-sandbox-controls)
- 全局 `[agents]` 可启停 multi-agent、限制 concurrent threads、设置默认 Subagent model/reasoning 与 interruption message。自定义 Agent 若与 built-in 同名则覆盖 built-in。[Codex Subagents](https://developers.openai.com/codex/subagents#global-settings)
- Codex Skill 遵循 Agent Skills；启动时先加载 metadata，匹配后读取完整 `SKILL.md`。Skill 可来自逐层 repo `.agents/skills`、user、admin 与 system。`agents/openai.yaml` 可声明展示信息、隐式调用策略和 MCP tool dependency。[Codex Skills](https://developers.openai.com/codex/skills)
- `[[skills.config]]` 以绝对 Skill 路径启停 Skill。由于 Agent TOML 可覆盖 `skills.config`，可以构造角色特定的 Skill 可见集，但官方 Agent 文档没有定义类似 Claude `skills: [name]` 的“启动时完整预加载”字段。[Codex Skills](https://developers.openai.com/codex/skills#enable-or-disable-local-codex-skills) · [Codex Subagents](https://developers.openai.com/codex/subagents#custom-agent-file-schema)
- Codex 普通配置优先级为 CLI/`--config` > 从 repo root 到 cwd 的 project config（closest wins，仅 trusted project）> selected profile > user > system > defaults；不信任项目时跳过 project config、hooks 和 rules。[Codex Config basics](https://developers.openai.com/codex/config-basic#configuration-precedence)

#### 边界与未确认

- **未确认：** 官方文档没有说明某 Agent 的 `skills.config` 是否能以一个声明式 allowlist 排除所有未列出 Skill，还是需要对已知路径逐项 `enabled = false`；因此不应把它宣传为严格 Skill 沙箱。
- **未确认：** 当前文档说自定义 Agent 格式“may evolve as authoring and sharing mature”；没有确认 Codex Plugin 安装会自动安装项目 `.codex/agents/*.toml`。本仓库若发布 Codex Agent adapter，必须做安装态测试而不是依赖推测。
- **综合判断：** Agent TOML 是强大的宿主适配层，但它继承普通 session config，实际 capability closure 取决于父配置、live override、project trust 和 Agent layer 的合并结果。

### 3.4 Google Gemini CLI：工具/MCP/Policy 强隔离，Skill 仍主要是会话级发现

#### 已验证事实

- Gemini Subagent 作为同名 tool 暴露给主 Agent，在独立 context loop 中运行并只返回结果；Agent 具有自己的 system prompt/persona 和工具集。[Gemini CLI Subagents](https://geminicli.com/docs/core/subagents/)
- 自定义 Agent 是 `.gemini/agents/*.md` 或 `~/.gemini/agents/*.md`；正文是 system prompt，frontmatter 支持 `tools`、inline `mcpServers`、`model`、`temperature`、`max_turns`、`timeout_mins`。工具支持 `*`、全部 MCP、特定 server MCP 通配符。[Gemini CLI Subagents](https://geminicli.com/docs/core/subagents/#creating-custom-subagents)
- Subagent 只能看见被授予的工具，即使授予 `*` 也不能调用其他 Subagent，官方明确以此防止递归与过量 Token。Policy Engine 规则可用 `subagent` 字段只匹配某个 Agent。[Gemini CLI Subagents](https://geminicli.com/docs/core/subagents/#isolation-and-recursion-protection) · [Subagent-specific policies](https://geminicli.com/docs/core/subagents/#subagent-specific-policies)
- Agent 可由 `/agents` 临时管理，也可在 `settings.json` 的 `agents.overrides` 持久覆盖 enabled/run/model config；model config override 可通过 `overrideScope` 指向 Agent。[Gemini CLI Subagents](https://geminicli.com/docs/core/subagents/#managing-subagents)
- Gemini Skill 激活有明确 consent：UI 显示 Skill 名称、用途及将获得访问的目录；批准后，`SKILL.md` body 和目录结构进入 conversation history，Skill 目录加入 allowed file paths。[Gemini CLI Agent Skills](https://geminicli.com/docs/cli/skills/#how-it-works)
- Skill 优先级从低到高为 built-in < extension < user < workspace；同层 `.agents/skills` alias 高于 `.gemini/skills`。Extension 能捆绑 prompts、MCP servers、commands、themes、hooks、Subagents 和 Skills。[Gemini CLI Agent Skills](https://geminicli.com/docs/cli/skills/#discovery-tiers) · [Gemini CLI Extensions](https://geminicli.com/docs/extensions/)

#### 边界与未确认

- **未确认/当前文档不可用：** Custom Agent schema 没有 `skills` 字段，Skill 页面也没有说明如何为某个 Subagent 预加载或仅允许一组 Skill。因此只能确认 per-agent tools/MCP/system prompt，不能确认 per-agent Skill binding。
- **未确认：** 所查官方页面没有给出 user/project 同名 Agent 的明确优先级，也没有完整描述每个 Subagent 的 transcript、Token/成本或 trace 导出。
- **综合判断：** Gemini 的 `tools` + inline MCP + Policy Engine 已足以把角色“禁止写入”从 Prompt 建议升级为运行时控制；但 Skill 精确可见性仍需宿主未来能力或独立 session/配置来实现。

### 3.5 Agent Skills：可移植内容格式，不是 Agent 权限标准

#### 已验证事实

- 标准要求 Skill 目录至少包含 `SKILL.md`，并允许 `scripts/`、`references/`、`assets/` 等附属资源；`name` 和 `description` 必需。[Agent Skills Specification](https://agentskills.io/specification)
- 标准推荐三层渐进披露：启动时 metadata，激活时完整 `SKILL.md`，其他资源按需读取；建议 `SKILL.md` 小于 500 行/5,000 tokens。[Agent Skills Specification](https://agentskills.io/specification#progressive-disclosure)
- `allowed-tools` 是实验字段，规范明确提示不同 Agent implementation 的支持可能不同。[Agent Skills Specification](https://agentskills.io/specification#allowed-tools-field)

#### 结论

**综合判断：** Agent Skills 解决“能力内容如何打包和按需披露”，不解决“哪个角色获得哪些 Skill”“Skill 是否是权限边界”“脚本在哪个 sandbox 运行”或“同名 Skill 如何跨宿主决议”。本项目可把四个角色 Skill 保持为可移植内容，但角色到 Skill 的绑定必须由各宿主 adapter 或 Main 的显式注入完成。

### 3.6 MCP：能力传输协议，不是角色配置协议

#### 已验证事实

- MCP 以 JSON-RPC 连接 Host、Client、Server；Server 可提供 Resources、Prompts、Tools，双方进行 capability negotiation，并有 progress、cancellation、errors、logging 等辅助机制。[MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- MCP 安全原则要求用户明确同意数据访问和操作；工具描述应视为不可信，除非来自可信 Server；协议本身不能强制这些原则，Host 必须实现授权和访问控制。[MCP Security and Trust & Safety](https://modelcontextprotocol.io/specification/2025-06-18#security-and-trust--safety)

#### 结论

**综合判断：** MCP 适合表达 Architecture 的 docs/diagram server、Product Test 的 browser server 或 Review 的 security-analysis server，但“Architecture 只能访问 A server、Development 可访问 B tool”不是 MCP 规范的一部分。Claude/Gemini 已展示 inline per-agent MCP；Codex 通过 per-agent config layer 达到相似效果。审计时还必须记录 server identity/version/config，不能只记录 tool 名称。

## 4. 对本仓库重构前架构的审计

### 4.1 已经做对的部分

1. 当时的 `.agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml` 把 `development`、`product-test`、`review`、`architecture` 的 routing、required/optional/prohibited capabilities、context 和 returns 分开，符合各宿主“窄角色 + 独立 context”的共同方向；这些语义现已迁入 internal Role Contract。
2. `.agents/skills/orchestrate-engineering-team/assets/role-task-packet.md` 明确只传 user outcome、focused question、相关文件/决定、允许写范围、available tools/limitations 和所需证据，符合 Claude/Codex/Gemini 对减少主线程 context pollution 的设计动机。
3. `.agents/skills/orchestrate-engineering-team/SKILL.md` 要求使用宿主原生 Subagent、运行前确认 Agent/工具存在、能力不可用时如实降级，不复制 sandbox/worktree/checkpoint。这与行业分工一致：Skill 负责策略，宿主负责执行边界。
4. 四个角色各自已有 canonical Skill，可继续遵循 Agent Skills 的渐进披露和跨宿主分发，而不把角色知识复制进每个平台配置。

### 4.2 实质缺口

| 严重度 | 文件 | 发现 | 影响 |
| --- | --- | --- | --- |
| **高** | `.agents/skills/orchestrate-engineering-team/references/agent-profiles.yaml` | `enforcement: advisory`，`prohibited` 与 `write_scope` 没有宿主绑定 | Main 可能把 Prompt 中的“read-only”误报为强制沙箱；带 `bash` 的 Agent 仍可能写入 |
| **高** | `.agents/skills/orchestrate-engineering-team/SKILL.md` | “use host native subagent”没有可验证的 role → native profile 映射 | 同一角色在 Pi/Claude/Codex/Gemini 上实际 tools、Skills、MCP、权限可能完全不同 |
| **中** | `agent-profiles.yaml` 各角色 `skill.path` | 只记录 Skill 文件路径，没有规定“完整预加载、按需可见、还是由 Main 拼接正文” | Claude 可原生 preload；Pi/Codex/Gemini 路径不同，安装后固定仓库路径也可能不可解析 |
| **中** | `role-task-packet.md` | 有 `Available tools` 和 limitation，但没有要求返回“实际生效 capability snapshot/provenance” | Main 难以区分配置意图与运行事实，也难以复现某次角色结论 |
| **中** | 整体 prompt-only dispatch | 没有声明 extension/package/MCP 版本或 trust 状态 | 相同 Prompt 在不同机器可能加载不同 ambient 能力，复现性不足 |
| **低** | 整体 | 返回格式强调 evidence/commands，但未统一关联 Subagent thread/run ID | 宿主已有 thread/hook/usage 时不能稳定连接到 Main 的最终证据 |

这些是架构审计发现，不表示当前仓库必须引入自己的运行时；相反，它们说明**不能把 advisory profile 当作运行时事实**。

## 5. 建议（非厂商事实）

### P0：保持 prompt-only 主架构，但建立“能力诚实性”契约

1. **建议：将 profile 分成 intent 与 effective 两个概念。**
   - 最终实现中，Intent 由 internal Role Contract 表达：required/optional/prohibited、write scope、context、returns；专业 Skill 改由配置叠加。
   - Effective 在每次 dispatch 前由宿主/ Main 解析：实际 Agent 类型、active tools、Skill 模式（preloaded/on-demand/unavailable）、MCP、sandbox、workspace isolation、model、来源和已知限制。
   - 如果宿主无法证明某项，则写 `unknown`/`advisory`，不得写 `enforced`。

2. **建议：把“只读”定义为能力组合，不只是角色文字。**
   - Architecture/Review/Product Test 优先使用宿主的 read-only sandbox/tool allowlist；
   - 如果必须给 `bash`，明确其可能绕过简单文件工具限制，并依赖 sandbox/policy，而不是 Prompt；
   - Development 写入共享 checkout 前检查宿主 worktree/sandbox 能力；并行 writer 没有隔离时转串行。

3. **建议：保留最小任务包，不自动复制完整父会话。**
   - 传 confirmed decisions、相关文件和 bounded question；
   - Review/Product Test 不传“期望通过”的暗示；
   - 需要 Role Skill 时优先用宿主原生 preload；不支持时才由 Main 读取 canonical `SKILL.md` 后把必要内容附加到 delegated prompt，并注明这是 fallback。

### P1：提供薄宿主适配，而不是自建 orchestration runtime

建议的映射如下：

| 本项目角色意图 | Claude Code adapter | Codex adapter | Gemini adapter | Pi adapter |
| --- | --- | --- | --- | --- |
| Role instructions | `.claude/agents/<role>.md` body | `.codex/agents/<role>.toml` `developer_instructions` | `.gemini/agents/<role>.md` body | 示例式 `.pi/agents/<role>.md` 或宿主自定义 Agent |
| Role Skill | Agent `skills: [name]` | Agent `skills.config` 或 prompt fallback；标明非 preload | prompt fallback/按需激活；标明未确认 per-agent binding | `pi-subagents` Agent `skills` + invocation-private `skillPath` |
| 工具 | `tools` + `disallowedTools` | `sandbox_mode` + session config/MCP | `tools` + Policy Engine | 严格 `tools` allowlist；provider 由 `extensions`/`subagentOnlyExtensions` 加载 |
| MCP | per-agent `mcpServers` | per-agent `mcp_servers` config | per-agent inline `mcpServers` | 可选择 direct MCP tool；provider/adapter 必须已安装，需报告实际可用性 |
| 写隔离 | `isolation: worktree` | 宿主 sandbox/worktree 能力；验证实际 client | sandbox/Policy；Agent schema 未见 worktree | `worktree: true` 或宿主 sandbox；没有时显式标记 shared |

适配文件应由 canonical profile 生成或受一致性测试约束，避免维护四套漂移的角色定义。它们是可选平台资源，不应成为开放 Skill 套件的必要前置。

### P1：最小可复现清单

每次有意义的委派建议记录或返回以下非敏感事实：

```yaml
role: review
contract_source: .agents/skills/orchestrate-engineering-team/references/role-contracts.yaml
host_agent: reviewer
host_agent_source: project|user|plugin|cli|unknown
model: <resolved model or unknown>
skills:
  - name: review-work-item
    mode: preloaded|on-demand|prompt-fallback|unavailable
    source: <resolved path/package/plugin>
tools:
  policy: allowlist|denylist|inherited|advisory
  effective: [read, grep, ...] # only when observable
mcp_servers: [<name/version or unknown>]
sandbox: read-only|workspace-write|inherited|unknown
workspace_isolation: worktree|sandbox|shared|unknown
thread_or_run_id: <host id if exposed>
limitations: []
```

不要记录隐藏 chain-of-thought、密钥、完整环境变量或敏感 MCP 数据。MCP 规范要求 Host 控制用户数据暴露；可观测性不应变成数据泄露渠道。[MCP Security](https://modelcontextprotocol.io/specification/2025-06-18#security-and-trust--safety)

### P2：验证与供应链

1. 对每个官方支持宿主做安装态 smoke：Agent 是否被发现、角色 Skill 是否实际 preload/可调用、prohibited tool 是否真的不可用、project trust 拒绝时发生什么。
2. Pin 可执行 Extension/Package/MCP server 版本或 commit；只在明确 review/trust 后启用项目本地动态能力。
3. 为 read-only 角色加入负向测试：尝试 `write/edit`、通过 shell 重定向写文件、调用未授权 MCP、调用其他 Subagent。
4. 把 capability snapshot 与宿主 thread/tool evidence 关联；不要求统一重型 trace backend。
5. 对“不支持 role-specific Skill”的宿主测试 prompt fallback，并限制注入文本规模，避免破坏独立 context 的收益。

## 6. 不建议做的事

- 不把 Agent Skills 的 `allowed-tools` 当作跨平台安全边界；规范明确是实验字段且实现支持不同。[Agent Skills Specification](https://agentskills.io/specification#allowed-tools-field)
- 不因 Claude 支持 `skills` 就把该字段写入 canonical Agent Skills frontmatter；它是 Claude Agent 字段，不是 Agent Skills 标准。
- 不假设 Plugin/Extension 安装就自动产生 per-agent 最小权限。分发边界、注册边界、运行边界是三件事。
- 不为实现角色注入而恢复 `.agent-work`、状态机或仓库自带调度 runtime。宿主 adapter 只需翻译 profile 并报告 effective capability。
- 不把独立 context 等同于独立 filesystem。Pi 示例、Codex thread、Gemini context loop 都需要额外 sandbox/worktree/policy 才能约束副作用。
- 不静默依赖用户级 Agent/Skill/MCP；用户级同名覆盖或 ambient 配置会降低团队复现性。

## 7. 推荐决策

**最终采用“canonical internal Role Contract + configurable professional capabilities + optional native adapters + effective capability attestation”分层设计：**

1. 以 Main Skill 内部四个 Role Contract 作为跨宿主角色语义源，删除四个公开 Role Skill；
2. 用户 Skill 只提供可配置专业能力，不再承担角色身份；
3. Main 继续动态、host-native dispatch，不建立自有 workflow engine；
4. 具体宿主 Adapter 作为未来独立可信 package 发布；首版核心只提供协议、fake conformance 测试和 prompt fallback；
5. 每次委派区分 requested 与 effective capability，无法验证时明确标为 advisory/unknown。

这一修正消除了“公开 Role Skill 同时是角色身份与专业能力”的混淆，同时保留研究中确认的宿主原生隔离和能力证明原则。

## 8. 一手资料

- [Pi Skills](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Pi Extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi Packages](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Pi Subagent official example](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent)
- [pi-subagents: Agent definitions](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md)
- [pi-subagents: Execution controls](https://github.com/nicobailon/pi-subagents/blob/main/skills/pi-subagents/references/execution-controls.md)
- [Anthropic Claude Code: Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- [Anthropic Claude Code: Extend Claude with skills](https://code.claude.com/docs/en/skills)
- [Anthropic Claude Code: Create plugins](https://code.claude.com/docs/en/plugins)
- [OpenAI Codex: Subagents](https://developers.openai.com/codex/subagents)
- [OpenAI Codex: Build skills](https://developers.openai.com/codex/skills)
- [OpenAI Codex: Config basics](https://developers.openai.com/codex/config-basic)
- [Google Gemini CLI: Subagents](https://geminicli.com/docs/core/subagents/)
- [Google Gemini CLI: Agent Skills](https://geminicli.com/docs/cli/skills/)
- [Google Gemini CLI: Extensions](https://geminicli.com/docs/extensions/)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Model Context Protocol Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)

## 9. 空白与残余风险

- 厂商文档更新很快，尤其 Claude 页面包含大量具体版本语义，Gemini 页面还标注了 2026 年的产品迁移提示；落地前必须以目标宿主版本复测。
- OpenAI 文档确认 Agent TOML 可含 `skills.config`，但没有确认它等价于严格 Skill allowlist 或启动时完整预加载。
- Gemini 官方文档没有确认 per-agent Skill binding，也没有完整说明 Subagent thread/usage 导出。
- Pi 核心仍未规定统一 Agent Profile；本文提出的精确 `skills`/`skillPath`/`subagentOnlyExtensions` 映射依赖 `pi-subagents` package，其他 delegate Extension 可能采用不同 schema。
- 所有 Prompt/Skill/Agent body 都可能携带 prompt injection；只有宿主工具、policy、sandbox、trust 与用户同意能构成执行边界。
- “可复现”仍受模型版本、远端 MCP server、网络内容、父会话 live override 和用户级配置影响；capability attestation 能暴露差异，不能消除全部非确定性。
