# 从 Harness Engineering 课程看当前 Skill：实践评估与改进路线

> 日期：2026-09-05。状态：研究与评估材料，**不是已接受的产品变更方案**。
>
> 结论：当前项目在「保持 Skill 轻量、明确事实与权限边界」上做得好；最需要补强的是「评估器自身的失败门禁、证据完整性，以及真实行为收益的验证」，不是再加角色、规则或状态机。

## 1. 范围、来源与结论强度

### 评估快照

- 目标仓库：`HandsomeGanzige/orchestrate-engineering-team`，分支 `ganzi/skill-design-v2`，基线 `7ee3785f1ce93324e050b59c7e07a85f6493e1fa`；开始时工作区干净。
- 课程：用户指定的本地 `learn-harness-engineering`，来源 `walkinglabs/learn-harness-engineering`，快照 `77e7a3e21469dcbece2558086c8d91657abeaa40`。课程工作区只有未跟踪的 `pnpm-lock.yaml`，本次未修改。
- 学习覆盖：英文正文 L01–L14、项目说明 P01–P08；重点检查 scope、verification、handoff、maker/checker、graph 示例。未逐份审阅项目应用实现、其他语言译本，也未运行课程实验。
- 项目检查：公开 Skill、角色请求与连续性资源、配置与 Adapter 实现、静态检查器、eval Runner/判定链路、测试、CI 和当前验收文档。
- 方法：主会话负责项目审阅、复现与最终材料；独立通用研究助手提供本地课程阅读笔记。研究助手的工具配置导致工作流最终报错，但笔记文件已落盘并经主会话读取；该状态不计作验证通过。
- 遵守根目录 `AGENTS.md`：本仓库 Skill/Role Contract 只作为被分析对象，未用其协调本次工作；未创建 `.agent-work/`。运行项目脚本仅限显式验证与临时 fixture。

证据分为三类：**已复现**表示本次实际运行观察；**源码事实**表示当前实现或文档可以直接确认；**待验证假设**表示合理风险或改进建议，尚无本项目收益数据。课程主张只证明「课程这样建议」，不自动证明有效性。本次未联网核验课程外链及其中的厂商数字。

当前行为以 [README](../../README.md)、[已接受设计](../design/single-main-skill-role-capability-injection.md)、[验收边界](../acceptance-report.md) 和源码为准；本文建议不覆盖它们。

## 2. 学习笔记：把课程转换成项目问题

课程的核心不是「模型多聪明」，而是让任务在可观察、可约束、可验证、可恢复的环境中完成。L02 正文按 **指令、工具、环境、状态、反馈** 划分子系统；课程 README 另用指令、状态、验证、范围、生命周期组织介绍。应按职责映射，而不是把分类名称当硬性架构。

| 课程 | 学到的原则 | 对当前项目的具体评估问题 |
| --- | --- | --- |
| [L01][l01] 强模型仍会失败 | 记录实际完成与失败归因，而非自信程度 | 是 Skill 行为失败，还是 Runner、fixture、Judge 误判？ |
| [L02][l02] Harness 五子系统 | 环境与反馈也属于可靠性设计 | 哪些由 Skill 提示，哪些由 CLI 检查，哪些只能由宿主保证？ |
| [L03][l03] 仓库是事实来源 | 新会话应能回答做什么、在哪、如何启动、验证与续接 | 能否从入口定位角色、schema、命令与最新验收边界？ |
| [L04][l04] 渐进披露 | 入口是地图，规则按需要加载 | Main 是否强塞所有角色和研究材料？删除一段文档是否仍能找到事实？ |
| [L05][l05] 跨会话连续性 | 保存目标、约束、证据、风险与下一步 | brief 陈旧时，新会话是否优先相信代码与用户的新要求？ |
| [L06][l06] 初始化独立 | 先验证工具和最小链路，再执行任务 | Node/pnpm、Skill 发现、宿主能力、最小 CLI 是否真实可用？ |
| [L07][l07] 范围与 WIP | 聚焦可验收单元，防止越界与半成品堆积 | 多写入者是否有明确所有权？小任务是否直接单 Agent 完成？ |
| [L08][l08] 功能与验收 | 行为、验证计划、执行证据不能混淆 | 通过来自实际运行，还是文件有字段、回复有关键词？ |
| [L09][l09] 防止提前宣布完成 | 终止判断要独立且基于运行结果 | Judge 输出好看，但进程失败或超时，是否仍能得到 PASS？ |
| [L10][l10] 跨边界验证 | 单测之外要走完整关键链路 | 配置→解析→能力诊断→派发→真实宿主结果，分别验证到哪里？ |
| [L11][l11] 可观测性 | 证据要能定位失败，也要控制采集范围 | 截断是否丢掉尾部失败？输出是否可能携带秘密？ |
| [L12][l12] 干净交接 | 明确已验证、未验证、剩余风险与恢复入口 | 能否保留原有工作区内容，而不是用清理命令伪造干净？ |
| [L13][l13] Loop | 独立 maker/checker、停止条件、成本与验证债 | 重试是否有收益？不能只测通过率而忽略人工与模型成本。 |
| [L14][l14] Graph | 显式责任、依赖、汇合、失败去向和审批 | 需要的是任务分工，还是一个持久化运行时？两者不可混称。 |

### 八个项目提供的是实验设计，不是本仓库的现成绩

- [P01][p01]：从等价初态比较 prompt-only 与 minimal harness；隔离答案污染，保留失败。
- [P02][p02]、[P03][p03]：新会话只靠仓库恢复，比较重发现时间、重复工作与目标漂移。
- [P04][p04]：植入缺陷，比较有无运行反馈的定位时间与无关修改量。
- [P05][p05]：比较单角色、generator/evaluator、planner/generator/evaluator；本项目可改为比较普通 Agent、当前 Main 和完整能力配置。
- [P06][p06]：固定任务做弱/强对比和消融；不能以文档或日志数量作为收益。
- [P07][p07]：对比手工与自动循环，记录人工干预、漏检、成本和停滞。
- [P08][p08]：画出隐式边，测试并行汇合、失败回退和人工批准，而非只展示流程图。

这些实验本次**未运行**。课程 P07 正文声称提供完整 starter/solution，但本地 `projects/project-07`、`projects/project-08` 均不存在；因此本次将它们作为练习设计，不作为实现证据。

## 3. 必须先划清三层，避免错误套课

| 层 | 当前职责 | 不应要求它承担什么 |
| --- | --- | --- |
| 产品 Skill | 选择角色、聚焦任务、注入能力、综合证据；通过宿主派发 | OS 沙箱、事务、队列、幂等、耐久调度 |
| 支撑库与 CLI | 配置解析/合并、路径检查、能力诊断、LaunchPlan 协议 | 自动安装插件；在无 Adapter 时冒充已验证的宿主执行 |
| 仓库开发与评估 harness | 确定性检查、临时安装、行为 fixture、Judge、报告 | 让被测 Skill 指挥自身开发；把一次模型成绩当发布证明 |

**没有 `feature_list.json`、`init.sh` 或 graph runtime，不自动构成坏实践。** 本项目已有 package scripts、测试、CI 和临时 eval 仓库等对应机制；课程要求的是职责被覆盖，不是复制文件名。把 `.agent-work` 变成权威数据库反而违反当前产品决策。[项目依据：已接受设计](../design/single-main-skill-role-capability-injection.md)

## 4. 好实践：值得保留的部分

### G1. 单 Main、角色可选，避免「组织架构表演」

**源码事实。** [SKILL.md](../../.agents/skills/orchestrate-engineering-team/SKILL.md) 的开头与 `Choose specialists dynamically` 明确：一个清晰改动走普通单 Agent；角色不是强制阶段；并发需要互不冲突的所有权或真实隔离。[single-agent-exit](../../evals/cases/single-agent-exit/case.json) 与 [dynamic-team-delivery](../../evals/cases/dynamic-team-delivery/case.json) 分别定义对应行为案例。

这符合 L07 的范围控制和 L14 的协调成本原则。应保留动态选择，不改为每次固定跑四个角色。**有案例不等于本次已证明多 Agent 更有效。**

### G2. 渐进披露，同时允许不增加文档

**源码事实。** Main 为 90 行，按需引用四角色契约、请求模板和检索指导，而非拼入全部材料。[检索指导](../../.agents/skills/orchestrate-engineering-team/references/retrievability-review.md) 使用 deletion test，不奖励文档、标签、锚点数量，也允许零修复的干净审查。

这比「每次失败就给提示词加一条」更接近 L04：事实应有唯一归属，噪声应删除。90 行只是结构观察，不是可靠性评分；真正需要测的是找对事实的成本和误判率。

### G3. 事实、工作摘要、研究与已确认决策分层

**源码事实。** Main 的 `Preserve continuity and authoritative facts` 要求从当前用户要求、代码、测试、diff 重新验证；[brief 模板](../../.agents/skills/orchestrate-engineering-team/assets/main-work-brief.md) 明确是非权威快照。[docs/README.md](../README.md) 区分当前契约与背景研究；[fresh-context-continuity](../../evals/cases/fresh-context-continuity/case.json) 定义两次独立候选会话和 ignore 保持检查。

这吸收 L03/L05/L12 的连续性原则，同时避免把摘要变成事实源。后续应扩大陈旧信息场景，而不是将 brief 升格成运行状态机。

### G4. 权限诚实，区分声明与有效执行边界

**源码事实。** [SECURITY.md](../../SECURITY.md)、[Adapter fallback](../../packages/adapter-contract/src/index.js) 明确提示词不是沙箱，未确认 tools/sandbox/isolation 一律 `unknown`；配置不会自动下载或信任 Adapter/MCP。

[validateMaterialPath](../../packages/config/src/index.js) 同时检查词法路径边界与 `realpath` 后的边界，覆盖符号链接逃逸；[配置测试](../../packages/config/test/config.test.js) 有对应负例。它比只写「不要越界」更接近可执行防线。不过通过路径检查不代表材料内容可信，Adapter 的能力声明校验也不等于 OS 强制隔离。

### G5. 有独立 evaluator，也有不能被分数覆盖的硬检查

**源码事实。** [runAttempt](../../scripts/evals/core.mjs) 在独立、只读、未复制被测 Skill 的仓库运行 Judge；候选结果还受命令、文件、changed-paths 等确定性检查约束。Judge 的总分达阈值还不够，所有 critical criteria 必须通过。

这符合 L08/L09/L13 的 worker/checker 分离。将候选消息标成不可信证据、要求引用依据也是好方向。但独立会话不是独立真相，当前执行状态门禁仍有 W1 的缺口。

### G6. 分层验证与能力说明相当克制

**已复现 + 文档事实。** 本次固定工具链 `corepack pnpm verify` 通过 30 项测试、静态检查、copied-package 和三包 tarball smoke。[验收报告](../acceptance-report.md) 明说：静态检查不启动真实专家；本地安装 fixture 不等于远程安装；无具体宿主 Adapter；工作区包未发布 npm；行为 eval 独立于 CI。

这正是 L09/L10 所需的证据分层。不要为了显得完整，把 `verify` 绿灯改写成「全宿主端到端已验证」。

### G7. 不用自身产品控制自身开发

**规则事实。** 根目录 [AGENTS.md](../../AGENTS.md) 禁止套件用于本仓库协调，只允许作为被测系统在临时 fixture 中运行。这避免被测规则同时定义开发流程和验收结论，符合独立核查的原则。保留这条约束。

## 5. 差实践与缺口：按风险而不是按文档数量排序

### W1. 高优先级｜Judge 执行失败，仍可能得到 PASS

**已复现，确定性实现缺陷。** `scripts/evals/core.mjs:344–349` 解析 Judge 的最终 JSON 并计算 `hardPassed && judge.passed`，但未把 Judge 的 `exitCode`、`timedOut`、`parseErrors` 纳入判定。候选 phase 有对应完成检查，Judge 没有对称门禁。

在临时 fixture 中使用现有 Fake Runner，候选正常完成；Judge 返回合法高分 JSON，同时分别注入以下状态：

| 注入的 Judge 状态 | 本次实际结果 | 应有行为 |
| --- | --- | --- |
| `exitCode: 1` | `passed: true` | 拒绝通过并保留失败原因 |
| `timedOut: true` | `passed: true` | 拒绝通过并标明超时 |
| `parseErrors: ["synthetic malformed JSONL"]` | `passed: true` | 拒绝通过或明确判为证据不完整 |

这直接违反 L09 的终止判断原则：**可信外观的回复不能覆盖执行失败。** [现有测试](../../scripts/evals/core.test.mjs) 测了进程超时和 Judge JSON 阈值，但没有把二者连到最终 attempt 判定。

最小后续修复：保存 Judge 运行状态，为它增加与 candidate 一致的完成条件，给三个负例加回归测试。本文只记录，不顺手修改实现。附录 A 可无模型复现。

### W2. 高优先级｜证据过滤不是完整脱敏，发布边界需更明确

**已复现局部行为；未观察到真实秘密泄露。** `scripts/evals/core.mjs:111–120` 主要按字段名删除 `reasoning/auth/token/secret` 等内容。合成输入中，`item.token` 被删除，但普通 `aggregated_output` 字符串内的 `TOKEN=SYNTHETIC_SECRET` 被保留。`final.md` 和 `diff.patch` 也直接写入相应文本，并未应用相同字段过滤。

当前 [evals/README](../../evals/README.md) 已提示日志本地保存、分享前审查，这是正确防线；不过「字段过滤」不能让人误以为全部输出已经安全。L11 的可观测性必须与数据最小化同时设计。

建议：先明确本地证据不是可直接公开的脱敏包；补合成标记覆盖 event/command output/final/diff/error 的测试；若需要分享，再设计显式导出和审查步骤。不要承诺正则能清除所有秘密，也不应保存完整环境来换取复现。附录 A 仅使用合成值。

### W3. 中优先级｜静态检查易奖励措辞，而不是行为

**源码事实，行为影响待测。** [checker.mjs](../../scripts/agent-profiles/checker.mjs) 用正则检查固定英文短语、用精确资源列表检查形状；diagnostic 位置统一为 `1:1`。这适合防止删除公开契约、带回旧 Role Skill，但存在两个盲区：同义改写可能误报；保留短语却在别处加入矛盾指令可能不被这些检查发现。

这对应 L04 的维护噪声和 L08/L14 的代理指标问题。不要删除结构检查；应把「文件/schema/权限字段」的机器契约与「模型是否遵守」分开，关键语义用带正负样本的行为案例验证。诊断可逐步给出真实位置和最小修复线索，而非继续增加一长串字符串匹配。

### W4. 中优先级｜新增检索指导，尚无专门行为收益证据

**明确的覆盖缺口，不是已证明无效。** [验收报告](../acceptance-report.md) 明说，当前十个案例尚未单独隔离或评分 bundled retrievability guidance；现有检查仅覆盖静态契约和打包。

L03/L04 要问的是「新 Agent 能否便宜、准确地恢复事实」。建议新建一组干净仓库与已植入检索缺陷的配对 fixture：陈旧 ADR、冲突配置说明、缺少关键不变量入口，以及本来已经能从测试直接发现事实的反例。分别测正确归属、错误事实采用、漏检、误报、查找成本。**干净仓库返回 pass、拒绝无用文档新增也是成功。**

### W5. 中优先级｜完整链路与边界故障仍有证据空白

**源码/文档事实 + 待验证风险。** [Adapter 包](../../packages/adapter-contract/src/index.js) 只有协议、conformance helper 和 generic fallback，没有具体 Adapter。Codex eval Runner 不等于角色 Adapter；[eval 文档](../../evals/README.md) 还说明可见事件可能只有 collaboration wait，缺少启动 prompt、child ID 和子上下文。

因此，当前无法从 wait 事件推导「完整角色包已注入」「独立上下文确实遵守权限」。`assertAuthorityNotExpanded` 检查声明的 prohibited/granted capability 重叠，也不能验证宿主实际权限。这个局限被诚实披露，不是必须立即开发 Adapter 的理由。

若要加强宿主保证，应先选一个实际目标宿主，在显式授权下测试完整注入、required 缺失、权限收窄、冲突写入与失败返回；宿主看不到的字段保持 unknown。E2E 在这里是 Skill→配置→派发→宿主效果→证据，不是照搬 Electron UI 测试。

### W6. 中优先级｜报告有界，但 Judge 可能只看到事件前缀

**源码事实；误判尚未运行复现。** `buildJudgePrompt`（`scripts/evals/core.mjs:261–263`）把事件和 diff 截为前 30,000 字符、最终消息截为前 20,000 字符。截断标记是好事，但尾部失败、最终修复或后续约束可能被丢失；Judge 也未获得完整候选仓库以自行补查。结果里没有按每条 criterion 表达缺失证据范围的专门机制。

这正是 L05/L11 的「信息压缩不能冒充全部事实」。建议做前缀噪声+尾部关键失败的负例；优先提供阶段摘要和关联证据，并把缺失证据判为 unknown/insufficient，而非让总分替代完整性。增加上下文上限不是唯一修复，也可能放大成本与隐私问题。

### W7. 中优先级｜能重复跑，但尚不能回答「复杂度是否值得」

**源码事实。** [runSuite](../../scripts/evals/core.mjs) 支持 repeat，保存逐次通过、Judge 分数与 usage；[报告生成](../../scripts/evals/core.mjs) 主要输出单次 PASS/FAIL 表。本次没有获得可发布的受控对照数据，也没有运行模型实验。

L13/L14 强调的是协调税和真实收益。现有机制尚不足以区分「多角色改善质量」与「只是投入了更多 token/时间」。应在同模型、同预算、等价初态下比较基线，并记录人工介入、返工、遗漏和成本。已有 usage 是基础，不应说完全没有成本数据。

## 6. 哪些课程做法不应照搬

1. **不要把经验行数或案例百分比变成指标。** L04 的 50–200 行是经验指导；课程案例的成功率、耗时和费用未在本次建立可复现数据链，不能外推为本项目承诺。
2. **不要把所有状态都放进 feature list。** 本项目事实来自代码、测试、用户要求和确认文档；brief 是索引。若将来需要耐久队列或副作用幂等，应另行决定宿主/runtime 边界。
3. **不要把 passing 视为永久有效。** 旧版本的通过证据必须保留版本和条件；代码、依赖或验收变化后应重验。
4. **不要为了 maker/checker 让 Reviewer 必须找错。** 课程 [checker 示例][checker-template] 有「找不到问题就是失败」式表达，容易鼓励误报；当前检索指导允许 clean pass 更好。独立性来自上下文和证据，不来自对抗性口吻。
5. **不要把示意程序当生产门禁。** 课程 [graph skeleton][graph-code] 明示不完整：模型调用未实现，测试/审查通过含字符串判断，checkpoint 使用内存。学习结构即可，不应复制这些判断来验收真实任务。
6. **不要把 worktree 等同权限沙箱，也不要自动 merge。** worktree 主要隔离 checkout；发布和不可逆操作仍由用户授权、宿主权限和实际证据决定。
7. **不要强行在每个仓库增加 init.sh 或全量 E2E。** 先确定关键边界的最小可执行检查；单测、集成、故障注入和 E2E 互补，任何测试组合都不是无缺陷证明。

## 7. 建议路线：先修验证可信度，再证明收益

以下是候选工作项，不是已批准实施的路线图。优先级表示相对次序，不代表所有项都应立即开发。

| 顺序 | 工作项 | 最小交付与验收 |
| --- | --- | --- |
| P1 | Judge 生命周期门禁（W1） | 三类异常即使带合法高分 JSON 也不得通过；报告保留明确运行失败原因；正常路径不回归 |
| P1 | 证据隐私说明与合成负例（W2） | 明确本地日志/可分享材料边界；四类文本载体有合成敏感标记测试；不宣称绝对脱敏 |
| P2 | 证据截断负例（W6） | 将关键失败放在长输出尾部，不能因未呈现给 Judge 而取得无依据通过 |
| P2 | 检索指导专门行为案例（W4） | 同时有已知缺陷与干净样本；测正确发现、误报和无用文档新增，而非标签数量 |
| P2 | 连续性对抗场景（G3） | 陈旧 brief、用户改验收、失败后换会话；恢复后重新读取当前事实，保留用户文件 |
| P3 | 单宿主能力证据（W5） | 根据真实需求选择宿主；只声明实际观测到的注入/权限/隔离，不把自报当强制保证 |
| P3 | 受控对照与静态检查减噪（W3/W7） | 先量化误报、漏检、成本，再决定简化或扩展；不以规则/角色数量衡量成熟度 |

### 推荐的评估协议

1. **固定实验材料**：记录 Skill commit、fixture hash、Runner/CLI 版本、候选与 Judge 的实际或可确认模型标识、配置和预算；未知值明确写 unknown。版本仅固定本次实验，不修改仓库默认模型策略。
2. **三个条件**：普通单 Agent 基线；当前 Main 无额外配置；当前 Main 加所需能力。执行前另行确认成本与认证使用，保持临时仓库隔离。必要时先扩展 Runner，不能假设当前脚本已支持所有基线条件。
3. **任务分层**：简单改动、跨模块兼容改动、required 能力缺失、跨会话恢复、检索缺陷。建议每类每条件至少 3 次独立尝试，作为探索性样本，不声称统计显著。
4. **主指标**：经独立 ground truth 确认的完成率、越界行为数、假通过率、漏检/误报；**副指标**：总耗时、token/费用、人工介入与返工。不要只按 Judge 总分排序。
5. **先查评估器再调 Skill**：失败先归因到 Runner、fixture、硬检查、Judge 或候选行为，保留初始失败基线，防止针对评测话术调优。
6. **最小消融**：分别去掉 brief 或检索指导，保持其他条件尽量一致；结合失败类型解释边际变化，不由一次总分下降推断唯一瓶颈。
7. **停止规则**：预算耗尽、重复无进展、权限未知或越界、证据不完整时停止或升级；不靠无限重试把失败洗成成功。

原始模型结果继续按当前政策保留在 ignored `evals/.runs/`；任何对外汇总或新发布材料需另行确认、脱敏和说明局限，不把诊断数据自动变成 release proof。

## 8. 本次实际验证与未验证项

| 检查 | 结果与边界 |
| --- | --- |
| Node / pnpm | Node `v22.22.3`；PATH 中 pnpm 是 `8.6.2`，先运行验证成功，但不算固定版本验证；随后 `corepack pnpm --version` 确认为 `10.13.1` 并重新验证 |
| `corepack pnpm verify` | 成功：30/30 Node tests、结构/host-neutral 检查、copied-package 和三包 tarball smoke；无真实模型调用 |
| `pnpm eval -- --list` | 成功：列出十个案例；仅枚举，未执行候选或 Judge |
| 附录 A 无模型探针 | 从本文提取原命令并执行，成功复现 W1 三种异常仍 PASS；W2 合成标记在普通输出中保留；仅临时 fixture，运行后清理 |
| 材料检查 | 项目相对链接均存在；24 个固定快照课程链接对应的路径均经本地 Git 对象核验；`git diff --check` 通过；未声称远程 HTTP 可达性已验证 |
| 实际模型行为 / 消融 / 成本比较 | **未运行**，不能声称 Skill 在这些实验中通过或优于基线 |
| 真实宿主 Adapter / 远程安装 / CI | **本次未验证**，不由本地测试代替 |

本次交付只新增分析材料并更新文档导航，不修改 Skill、实现、测试或配置。W1 等问题仍需后续独立修复。

## 附录 A：无模型最小复现

在目标仓库根目录运行以下命令。只导入 eval harness 和 Fake Runner，不启动被测 Skill/真实 Agent，不使用认证，不写 `evals/.runs/`；创建的临时目录在 `finally` 中清理。

```bash
node --input-type=module <<'JS'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAttempt, filterEvents } from './scripts/evals/core.mjs';
import { createFakeRunner } from './scripts/evals/runners/fake.mjs';
const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'oet-analysis-'));
try {
  const caseDir = path.join(temp, 'case');
  await mkdir(path.join(caseDir, 'fixture'), { recursive: true });
  await writeFile(path.join(caseDir, 'fixture', 'README.md'), 'synthetic fixture\n');
  const evalCase = {
    id: 'judge-lifecycle-probe', title: 'Judge lifecycle probe',
    description: 'Synthetic failure injection', timeoutMs: 10000,
    sandbox: 'read-only', caseDir,
    phases: [{ id: 'one', prompt: 'No changes.' }], checks: [],
    judge: { threshold: 80, criticalCriteria: ['ok'] },
    rubric: 'ok: candidate makes no changes',
  };
  for (const failure of [
    { exitCode: 1 }, { timedOut: true },
    { parseErrors: ['synthetic malformed JSONL'] },
  ]) {
    const runner = createFakeRunner({ runs: [
      { exitCode: 0, events: [], finalMessage: 'No changes.' },
      {
        exitCode: 0, timedOut: false, parseErrors: [], ...failure, events: [],
        finalMessage: JSON.stringify({
          caseId: evalCase.id, score: 90,
          criteria: [{ id: 'ok', passed: true,
            evidence: 'No changed paths', explanation: 'No changes requested' }],
          violations: [], summary: 'pass',
        }),
      },
    ] });
    const result = await runAttempt({
      evalCase, attempt: 1, runner, root, runsRoot: path.join(temp, 'runs'),
      skillRoot: path.join(root, '.agents/skills/orchestrate-engineering-team'),
    });
    console.log({ failure, passed: result.passed, hardPassed: result.hardPassed });
  }
  console.log(JSON.stringify(filterEvents([{
    type: 'item.completed', item: {
      type: 'command_execution', token: 'SYNTHETIC_SECRET',
      aggregated_output: 'TOKEN=SYNTHETIC_SECRET',
    },
  }])));
} finally {
  await rm(temp, { recursive: true, force: true });
}
JS
```

基线观察：前三行均包含 `passed: true, hardPassed: true`；最后一行不含 `token` 字段，但保留 `aggregated_output` 中的合成标记。**这是缺陷复现结果，不是应长期保持的期望测试结果。** 后续修复后应更新该版本的观察，不修改本快照的历史事实。

## 附录 B：课程来源索引

下列链接固定到课程快照，便于远程读者核对，不依赖作者本地绝对路径。项目内链接与源码行号对应第 1 节的目标基线；后续实现变动可能使行号漂移。

- L01–L04：失败归因、五子系统、事实来源、渐进披露。
- L05–L08：连续性、初始化、范围、执行证据。
- L09–L12：终止门禁、跨边界测试、观测、交接。
- L13–L14：独立核查、停止与成本、分工与控制关系。
- P01–P08：对照、恢复、反馈、独立验收、消融、loop 与 graph 实验设计。

[l01]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-01-why-capable-agents-still-fail/index.md
[l02]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-02-what-a-harness-actually-is/index.md
[l03]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-03-why-the-repository-must-become-the-system-of-record/index.md
[l04]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-04-why-one-giant-instruction-file-fails/index.md
[l05]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-05-why-long-running-tasks-lose-continuity/index.md
[l06]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-06-why-initialization-needs-its-own-phase/index.md
[l07]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-07-why-agents-overreach-and-under-finish/index.md
[l08]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-08-why-feature-lists-are-harness-primitives/index.md
[l09]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-09-why-agents-declare-victory-too-early/index.md
[l10]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-10-why-end-to-end-testing-changes-results/index.md
[l11]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-11-why-observability-belongs-inside-the-harness/index.md
[l12]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-12-why-every-session-must-leave-a-clean-state/index.md
[l13]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-13-loop-engineering/index.md
[l14]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-14-graph-engineering/index.md
[p01]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-01-baseline-vs-minimal-harness/index.md
[p02]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-02-agent-readable-workspace/index.md
[p03]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-03-multi-session-continuity/index.md
[p04]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-04-incremental-indexing/index.md
[p05]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-05-grounded-qa-verification/index.md
[p06]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-06-runtime-observability-and-debugging/index.md
[p07]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-07-loop-engineering-first-loop/index.md
[p08]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/projects/project-08-graph-engineering-first-graph/index.md
[checker-template]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-13-loop-engineering/code/checker-prompt.md
[graph-code]: https://github.com/walkinglabs/learn-harness-engineering/blob/77e7a3e21469dcbece2558086c8d91657abeaa40/docs/en/lectures/lecture-14-graph-engineering/code/maker_checker_graph.py
