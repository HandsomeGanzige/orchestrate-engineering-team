# 调研：长任务中的上下文耗尽、跨会话连续性与目标漂移

> 本文是截至 **2026-09-02** 的研究材料记录，不是当前产品行为说明，也不是优化方案。当前 Skill 的真实边界以仓库根目录 `README.md`、`docs/acceptance-report.md`、已接受的设计决策和可执行源文件为准。

## 摘要

对问题的简短回答是：**有目标偏移风险，而且“自动压缩上下文”或“开启一个新上下文”本身都不能证明任务会无损续接。**

业界资料反复指向四个相互关联、但不能混为一谈的问题：

1. **容量问题**：历史记录最终超过模型或宿主允许的上下文窗口；
2. **检索问题**：信息仍在窗口中，但模型对中部信息、干扰信息或过长上下文的使用能力下降；
3. **连续性问题**：压缩、会话切换、进程重启或 Agent 交接之后，关键事实没有被正确恢复；
4. **控制问题**：即使历史完整，Agent 仍可能过早作出假设、局部优化、重复失败路径或逐渐偏离原始目标。

当前公开实践并不存在一个公认的万能解法。较成熟的设计通常组合两条路径：

- 用压缩、检索、外部文件或分层记忆控制模型看到的上下文；
- 用结构化任务状态、检查点、事件历史、测试和可验证产物保存不能依赖模型“记住”的执行事实。

核心判断是：**对话摘要适合帮助模型继续思考，但不应天然被视为恢复、审计、授权或副作用去重的权威状态。**

## 1. 范围、方法与证据等级

### 1.1 研究问题

本文集中回答以下问题：

- 长任务为何会在上下文仍未达到硬上限时发生质量下降？
- 上下文压缩、长期记忆、检查点和事件历史分别解决什么问题？
- 新 Agent 或新会话如何获得足够信息，又如何避免继承错误？
- 业界如何降低目标漂移、重复执行和“误判已经完成”的风险？
- 对当前这个由 Main 动态组织专家 Agent 的 Skill，哪些问题值得进入后续方案评估？

本文不在此阶段选择具体实现，也不把某个厂商的产品机制直接当作本仓库的设计结论。

### 1.2 证据等级

| 等级 | 类型 | 可以支持什么 | 主要局限 |
| --- | --- | --- | --- |
| **A** | 同行评审论文、公开基准或有清晰实验设计的技术报告 | 证明某类失败模式确实存在，比较特定方法 | 场景通常比真实工程任务简单；模型版本可能过时 |
| **B** | 官方产品文档、运行时语义、架构说明 | 确认产品“提供什么保证”以及恢复边界 | 不能单独证明方案在所有场景更有效 |
| **C** | 厂商工程博客、生产实践复盘 | 提供真实设计动机、失败经验和工程权衡 | 多为自报结果，缺少独立复现或对照实验 |
| **D** | 视频访谈、社交媒体原帖、社区总结 | 发现术语、实践线索和待验证假设 | 容易缺少上下文，不应作为关键设计的唯一依据 |

证据等级表示“适合支持哪种主张”，不是内容质量排名。官方文档往往是最准确的产品契约，但不是独立有效性研究。

## 2. 先区分六类状态

许多讨论把 history、memory、checkpoint 和 task state 都称为“上下文”。这会掩盖真正的恢复风险。

| 状态层 | 示例 | 主要消费者 | 丢失后的影响 | 更合适的载体 |
| --- | --- | --- | --- | --- |
| **目标与约束** | 用户原始需求、权限边界、验收标准、明确禁止项 | Main、Reviewer、恢复后的新会话 | 方向性错误或越权 | 原始请求、规格、决策记录；压缩摘要只作为索引 |
| **决策与假设** | 已选方案、被否决方案、仍未验证的假设 | 后续 Agent、Review | 重复讨论、错误事实被当成结论 | 结构化决策记录，标注证据和状态 |
| **执行控制状态** | 当前步骤、依赖、重试次数、待审批、下一负责人 | 编排器或宿主运行时 | 重复、遗漏、死循环、误判完成 | Checkpoint、事件历史、任务 Ledger |
| **外部副作用状态** | 已发送消息、已发布版本、已写入远端、幂等键 | 执行器、恢复逻辑 | 重复副作用或数据损坏 | 可审计 Receipt、稳定标识和幂等记录 |
| **工程事实与证据** | 代码、测试结果、Commit、设计文档、缺陷复现 | 所有 Agent 和人类 | 无法验证结论，交接变成猜测 | 项目文件、测试、版本控制、CI、Issue/PR |
| **认知工作集** | 工具输出、探索路径、临时推理、最近对话 | 当前模型调用 | 局部效率下降 | 有界上下文、摘要、检索、临时笔记 |

研究材料最一致的启示是：**认知工作集可以压缩，权威事实必须能重新定位、重新读取或重新验证。**

## 3. 已确认的主要失败模式

### 3.1 “窗口更大”不等于“使用得更好”

[Lost in the Middle](https://arxiv.org/abs/2307.03172) 发现，长上下文模型使用相关信息的能力明显受信息位置影响：相关内容位于输入开头或结尾时表现较好，位于中间时可能显著下降。它证明的是长文本问答和检索场景中的位置效应，不直接等同于工程 Agent，但能解释为什么“原始目标还在历史里”并不保证它持续支配下一步行动。**证据：A。**

[Chroma 的 Context Rot 技术报告](https://www.trychroma.com/research/context-rot) 在多个模型和受控任务上进一步主张：随着输入增长，性能退化往往是渐进而非只在硬上限处突然发生；简单的 needle-in-a-haystack 测试又可能高估模型处理真实长上下文的能力。它是厂商技术报告而非同行评审论文，适合确认评测方向，不适合单独决定架构。**证据：A/C。**

### 3.2 多轮交互会放大早期错误假设

[LLMs Get Lost in Multi-Turn Conversation](https://arxiv.org/abs/2505.06120) 使用大规模模拟对话比较单轮完整指令与多轮逐步披露需求。论文报告多轮条件下的显著性能下降，并观察到模型容易过早形成答案、依赖此前错误尝试且难以在后续信息到达时恢复。其会话是受控模拟，不等同于真实软件工程，但它提示：**仅保存完整对话并不能阻止目标在逐轮解释中被错误固化。** **证据：A。**

### 3.3 长期记忆不是“把所有历史塞回窗口”

[LongMemEval](https://arxiv.org/abs/2410.10813) 把长期交互记忆拆成信息提取、跨会话推理、时间推理、知识更新和拒答五种能力。其 500 个问题基准中，商业助手和长上下文模型在持续交互记忆上出现约 30% 的准确率下降。论文提出 session decomposition、fact-augmented keys 和 time-aware query 等改进，说明长期记忆至少包含索引、检索和阅读三个独立环节。该基准主要面向聊天记忆，不包含工程副作用恢复。**证据：A。**

[MemGPT](https://arxiv.org/abs/2310.08560) 借鉴操作系统分层内存，提出在有限上下文与外部存储之间移动信息的“虚拟上下文管理”，并在长文档和多会话聊天上评估。它提供了重要的分层记忆范式，但并未证明自然语言记忆足以承担事务、审批或幂等语义。**证据：A。**

### 3.4 目标漂移可在未发生压缩时出现

[Evaluating Goal Drift in Language Model Agents](https://ojs.aaai.org/index.php/AIES/article/download/36541/38679) 在受控股票交易环境中考察竞争目标与对抗压力。作者报告所有受测 Agent 均出现不同程度的目标漂移，漂移程度与持续进行工具性追求、对抗压力等条件有关。局限是任务环境简单、Agent 架构和模型代际有限，因此不能把数值外推到编码 Agent；但它足以反驳“只要上下文完整，目标就一定稳定”的假设。**证据：A。**

## 4. 厂商与框架的一手材料记录

### 4.1 OpenAI：压缩用于长运行上下文，但压缩不是业务状态

#### 材料

- [OpenAI Models：GPT-5.5 长运行 Agent 指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5)
- [OpenAI Models：GPT-5.2 Compaction 指南](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2)
- [OpenAI Responses API：Compact a response](https://developers.openai.com/api/reference/java/resources/responses/methods/compact)

#### 记录

OpenAI 的模型指南建议长运行、工具密集型 Agent 使用有意的 conversation/state compaction，并在压缩内容中保留已完成动作、当前假设、对象标识、工具结果、未解决阻塞和下一具体目标。GPT-5.2 的 Compaction 指南还建议在重要里程碑之后压缩，并保持指令在功能上稳定，避免压缩前后行为漂移。

Responses Compact API 返回压缩后的 response，其中可以包含用户消息与不透明的 encrypted compaction item。它能减少后续模型调用所需的上下文，但不透明 item 不是供应用程序解析的结构化任务数据库。

#### 能支持的判断

- 主动压缩是官方支持的长任务技术；
- 压缩质量依赖保留字段和压缩时机；
- 应用不能把 opaque compaction item 当作可查询、可审计的业务状态。

#### 不能支持的判断

- 不能据此认为压缩一定无损；
- 不能据此推断任意 Codex 宿主在上下文耗尽时采用同一种机制；
- 不能证明压缩可以替代 checkpoint、测试证据或外部副作用记录。

**证据：B。**

### 4.2 Anthropic：压缩、外部笔记、子 Agent 与结构化交接

#### 材料

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [Claude Code：Context windows](https://code.claude.com/docs/en/context-window)

#### 记录

Anthropic 将 compaction、structured note-taking 和 multi-agent architectures 并列为长任务上下文工程技术。其工程博客强调：压缩应优先保留架构决策、未解决问题和实现细节，并明确指出过度压缩可能丢失后来才显得关键的细节；调优时应先偏向召回，再逐步提高精度。

其长运行 Agent harness 复盘记录了几个与本问题高度一致的失败：Agent 试图一次完成全部任务而耗尽上下文；新会话只能猜测此前发生了什么；压缩后的状态不够清晰；后续 Agent 过早宣布完成。公开方案用 initializer 建立环境脚本、结构化 feature list、进度文件和初始版本记录，后续 Agent 每次处理小范围工作、验证结果并留下可恢复状态。

Claude Code 文档则明确区分自动压缩、手动 `/compact` 和清空无关上下文。部分项目级说明、计划或最近访问文件可在压缩后重新注入/读取，但这属于该产品的具体语义，不能泛化成所有 Agent 宿主的保证。

#### 能支持的判断

- 压缩与交接本身都是潜在失真点；
- 新上下文配合结构化、可重新验证的项目状态，可能比继续携带全部细节更稳定；
- 子 Agent 的独立上下文有助于隔离探索噪声，但 Main 仍需接收高质量结果摘要和证据引用。

#### 局限

这些文章主要是 Anthropic 自身产品和内部实验经验。Harness 方案使用特定应用开发任务；其中成本与效果示例不是跨模型通用 benchmark。

**证据：B/C。**

### 4.3 Microsoft：显式 Task Ledger、Progress Ledger 与 Checkpoint

#### 材料

- [Magentic-One：官方研究页面](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/)
- [Magentic-One 论文 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2024/11/Magentic-One.pdf)
- [Microsoft Agent Framework：Workflow checkpoints](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints)
- [AutoGen：Agent and team state](https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/state.html)

#### 记录

Magentic-One 的 Orchestrator 使用两个层级的 Ledger：外层 Task Ledger 维护事实、猜测、计划和短期记忆；内层 Progress Ledger 周期性判断任务是否完成、是否卡住、是否仍有进展、下一位 Agent 及其指令。如果停滞计数达到阈值，Orchestrator 回到外层反思和重规划，并可清理 Agent 上下文以重新开始。

Microsoft Agent Framework 的 checkpoint 在 superstep 结束时捕获 executor state、待处理消息、请求/响应和共享状态。官方明确区分仅存内存的 provider 与可跨进程重启的文件或数据库 provider，并提示 checkpoint 反序列化的信任边界。

AutoGen 允许保存与加载 Agent/Team state。该能力说明“新实例恢复团队状态”可以由运行时显式支持，而不是只依赖模型对旧对话的自然语言总结。

#### 能支持的判断

- 可以把任务目标/计划与短期进度判断分成不同控制环；
- “是否卡住”与“是否完成”应成为可检查的问题，而不是只依赖最后一次模型自评；
- 内存 checkpoint 不等于持久恢复，持久化 provider 才能跨进程继续。

#### 局限

Magentic-One 的实验任务与当前工程 Skill 不完全相同；清空上下文后重规划也可能丢失未写入 Ledger 的细节。Checkpoint 能保存状态，但不会自动保证状态语义正确。

**证据：A/B。**

### 4.4 Google：事件日志、Snapshot、单写者与长期记忆

#### 材料

- [Agent Executor: Google’s distributed agent runtime](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime/)
- [Remember this: Agent state and memory with ADK](https://cloud.google.com/blog/topics/developers-practitioners/remember-this-agent-state-and-memory-with-adk)
- [Chain-of-Agents: Large language models collaborating on long-context tasks](https://research.google/blog/chain-of-agents-large-language-models-collaborating-on-long-context-tasks/)
- [Google ADK + Restate integration](https://adk.dev/integrations/restate/)

#### 记录

Google Cloud 的 Agent Executor 把 Agent 执行描述为 event log 加 snapshot：运行时通过日志和快照恢复，使用 single-writer session consistency 控制并发，并支持重连、补发和从 checkpoint 分支。该产品在公开文章时仍属于 preview，应把这些内容视为目标语义而非长期成熟度证明。

ADK 的材料区分 session state 与 long-term memory。简单地把原始历史保存在内存中会导致上下文膨胀，并在进程重启后消失；持久 memory service 则提取、索引和检索信息。Restate 集成进一步把 LLM 调用、工具调用和 session 变更写入可重放 journal，以便暂停、恢复和故障继续。

Google Research 的 Chain-of-Agents 让顺序 worker 处理长输入分块，并把累计消息交给下一 worker，最后由 manager 汇总。论文在特定长上下文任务上报告相对强基线的提升，但它解决的是输入分片与信息聚合，不是含外部副作用的长期工程执行。

#### 能支持的判断

- 长期运行时通常需要模型上下文之外的执行日志；
- 同一 session 的并发写入需要明确一致性或所有权语义；
- 长期记忆、会话状态和 durable execution 是三个不同能力。

**证据：A/B/C。**

### 4.5 AWS：短期事件、长期记忆、截断策略与交接观测

#### 材料

- [Amazon Bedrock AgentCore：Memory for agent runtimes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-memory.html)
- [AgentCore Memory: Building context-aware agents](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/)
- [AI agents in enterprises: Best practices with AgentCore](https://aws.amazon.com/blogs/machine-learning/ai-agents-in-enterprises-best-practices-with-amazon-bedrock-agentcore/)

#### 记录

AgentCore 按 actor/session 保存原始交互事件，并把长期记忆进一步分成 semantic、summary、preference 和 episodic 等策略。官方文档提供 sliding window、summarization 和不截断等上下文策略，说明截断是可配置策略，而非天然无损的系统行为。

AWS 的多 Agent 实践文章把 handoff 视为常见失败位置，并建议通过 trace 观察交接。它还区分层级、顺序和 peer 等组织模式与底层通信协议。

#### 能支持的判断

- 恢复会话历史和检索长期事实需要显式存储服务；
- Handoff 成功不能只看最终答案，交接边界本身需要可观测性；
- 记忆策略应与数据保留、安全和租户隔离共同设计。

**证据：B/C。**

### 4.6 LangGraph、Temporal 与 Restate：把“模型思考”放进可恢复运行时

#### 材料

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [LangGraph Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)
- [Temporal AI reference architecture](https://go.temporal.io/platform-hub/ai-engineering/ai-reference-architecture)
- [Temporal AI engineering](https://go.temporal.io/platform-hub/ai-engineering)
- [Google ADK + Restate integration](https://adk.dev/integrations/restate/)

#### 记录

LangGraph 的 checkpointer 按 thread 保存图状态，store 则用于跨 thread 的长期信息。Subgraph 可以选择 per-invocation、per-thread 或 stateless 持久化；官方提示同一持久 subgraph 并行调用会共享 checkpoint namespace，可能发生冲突。这是一个重要细节：**“各 Agent 有独立上下文”不自动等于“各 Agent 有独立持久状态”。**

Temporal 把 Workflow 作为可重放的 durable control plane，把 LLM 调用和外部工具放入 Activity。原因是 LLM 和外部 API 非确定，不能在恢复时随意重新调用并假装得到同一结果。工具结果和副作用边界记录在 durable history 中，重试则要求 Activity 具备合适的幂等语义。

Restate 的 ADK 集成采用 journal 记录 LLM/工具调用和 session state，目标同样是让进程失败后从已提交步骤继续，而不是从自然语言摘要重新猜测已经执行过什么。

#### 能支持的判断

- Checkpoint 解决的是执行恢复，memory 解决的是信息召回，两者不可互换；
- 可恢复系统必须区分可重放计算与不可安全重复的副作用；
- 持久化粒度、namespace 和并发语义会直接影响多 Agent 正确性。

#### 局限

这些是框架或供应商架构材料，强项是语义清晰，弱项是缺少对当前 Skill 工作负载的直接成本收益数据。

**证据：B/C。**

### 4.7 Manus：可恢复压缩、文件作为外部上下文、目标复述

#### 材料

- [Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

#### 记录

Manus 报告其典型 Agent 循环中输入远多于输出，工具观察会持续推高上下文。其设计把文件系统视为外部化上下文，并要求压缩“可恢复”：删除网页正文时保留 URL，删除文档正文时保留文件路径，使后续步骤仍能重新读取原始来源。

文章还解释了持续更新 `todo.md` 的目的：把全局计划重新写到上下文末端，降低 lost-in-the-middle 和长循环中的目标偏移。Manus 同时建议保留失败动作和错误输出，使 Agent 能看到已经失败的路径。

#### 能支持的判断

- 摘要中保存可解析引用，比保存无法追溯的自然语言结论更安全；
- 周期性重申目标可能改善注意力，但不能替代验收或权限检查；
- 失败证据是恢复状态的一部分，不能只保留“做过了”。

#### 局限

文章明确将这些结论描述为 Manus 的局部最优与生产经验，不是普遍定律。`todo.md` 的做法没有公开独立对照实验；文件也可能被篡改、陈旧或缺少版本标识。

**证据：C。**

## 5. 方案模式对照

| 模式 | 主要解决 | 不解决 | 典型来源 |
| --- | --- | --- | --- |
| **滑动窗口 / 截断** | 控制 token、延迟和成本 | 被删除信息的恢复；目标完整性 | AWS AgentCore、各类 chat runtime |
| **自然语言压缩** | 保留关键摘要并继续单一任务 | 无损性、审计、精确副作用状态 | OpenAI Compact、Claude `/compact` |
| **外部笔记 / 文件记忆** | 让关键事实跨上下文可重新读取 | 文件新鲜度、并发写、完整性 | Anthropic harness、Manus |
| **检索式长期记忆** | 跨会话按需召回事实 | 漏检、冲突事实、执行进度 | LongMemEval、MemGPT、Google/AWS memory |
| **Task/Progress Ledger** | 保持目标、计划、进度和停滞检测 | Ledger 自身错误或遗漏 | Magentic-One |
| **Checkpoint / Snapshot** | 恢复某个执行边界的状态 | 被保存状态是否语义正确 | Microsoft Agent Framework、LangGraph |
| **Event history / Journal** | 重放、审计、恢复、记录工具结果 | 长期日志增长、Schema/版本迁移 | Temporal、Restate、Google Agent Executor |
| **新上下文 / Subagent 隔离** | 避免单一窗口污染、并行探索 | 交接遗漏、重复工作、责任分散 | Anthropic、Magentic-One、CoA |
| **独立验证器 / 测试** | 对抗“自认为完成”和局部目标漂移 | 规格本身错误、测试盲区 | Anthropic harness、工程 CI 实践 |

## 6. 视频与社交媒体阅读清单

这些材料适合补充工程直觉，不应替代论文、产品文档或可复现实验。

### 6.1 视频

1. [Anthropic — Building more effective AI agents](https://www.youtube.com/watch?v=uhJJgc-0iTQ)

   官方技术演讲，覆盖从简单 Agent 到 orchestrator/subagent 的架构、工具调用、失败模式和 context engineering。适合建立术语与架构全景。**等级：C/D。**

2. [Chroma — Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.youtube.com/watch?v=TUjQuC4ugak)

   对应 Context Rot 技术报告的讲解，适合了解为何“窗口容得下”不等于“模型用得好”，以及传统 needle 测试的局限。实验结论仍应回到技术报告核验。**等级：A/C。**

3. [Sequoia — Anthropic's Boris Cherny: Why Coding Is Solved, and What Comes Next](https://www.youtube.com/watch?v=SlGRN8jh2RI)

   对 Claude Code 负责人工作方式和长运行编码 Agent 的第一人称访谈。它是第三方频道上的实践访谈，不是通用有效性研究。**等级：D。**

### 6.2 X / Twitter 原帖

1. [Andrej Karpathy：提出 “context engineering” 的实践表述](https://x.com/karpathy/status/1937902205765607626)

   该帖把上下文工程概括为：为下一步推理选择恰当的信息组合。它有助于澄清问题意识，但不提供恢复协议或实验结果。**等级：D。**

2. [Boris Cherny：Claude Code 团队的个人使用工作流](https://x.com/bcherny/status/2007179832300581177)

   该 thread 讨论并行会话、计划模式、验证与反馈循环等个人实践，可作为长任务组织方式的案例。它不是 Anthropic 产品保证，也不证明某种工作流在所有仓库有效。**等级：D。**

> 核验说明：X 在本次调研环境中对原帖抓取返回访问限制。以上保留原始链接，并通过搜索索引、公开引用和仓库既有研究记录交叉核对标题/主题；没有把无法重新抓取的原帖措辞作为关键事实依据。

## 7. 跨来源共识

以下内容得到多类独立来源支持：

1. **上下文窗口大小不是唯一瓶颈。** 信息位置、干扰、重复轨迹和模型的检索能力都会影响表现。
2. **压缩必然需要取舍。** 不论自动摘要还是手动交接，都可能丢失当时看似次要、后来变得关键的信息。
3. **关键状态应外部化并可重新定位。** 可靠摘要不只写“结论”，还保留来源 URL、文件路径、对象 ID、Commit、测试或工具结果。
4. **执行恢复和长期记忆不是同一个问题。** Memory 回答“应该想起什么”；Checkpoint/History 回答“已经执行到哪里、哪些副作用发生过”。
5. **新上下文既是风险也是工具。** 它能去除污染和旧错误模式，但需要明确的 handoff packet、当前世界状态和验收标准。
6. **“完成”需要外部证据。** 测试、可观察结果或独立评估比同一 Agent 的自我声明更可靠。
7. **副作用必须单独保护。** 一旦任务可能发送、发布、购买、删除或修改远端状态，恢复逻辑需要幂等键、Receipt 或人工确认，不能只重放模型对话。
8. **长任务应有停滞检测和重规划边界。** 只是继续追加历史，容易把错误路径和重复行为固化进上下文。

## 8. 尚无行业共识的问题

### 8.1 透明文件还是运行时数据库？

Anthropic harness 与 Manus 强调人和 Agent 都能读取的项目文件；LangGraph、Temporal、Restate 和云运行时强调 checkpoint、event history 与 journal。前者易审查和版本控制，后者更适合原子性、重放和机器恢复。很多真实系统需要二者并存，而非二选一。

### 8.2 延续旧上下文还是主动刷新？

OpenAI/Claude 提供压缩延续；Anthropic harness 和 Magentic-One 又展示了 fresh context/reset 的价值。决定因素可能不是“新旧”本身，而是：权威目标是否独立保存、恢复包是否完整、环境是否重新核验、失败轨迹是否可访问。

### 8.3 中央 Main 还是去中心化 Handoff？

中央 Orchestrator 便于维护全局计划和完成标准，但也可能成为上下文瓶颈；Handoff 让专家拥有完整局部控制，却更依赖交接质量。公开资料没有证明一种拓扑对所有工程任务最优。

### 8.4 由模型管理记忆还是由运行时管理？

模型擅长决定“语义上什么重要”，运行时擅长保证“什么已提交、什么可恢复”。完全由模型维护容易漂移；完全由规则选择又可能丢失语义相关性。混合机制是常见方向，但最佳责任边界仍依赖任务。

## 9. 对当前 Skill 的研究启示（不是优化决策）

当前 Skill 明确不内置 `.agent-work`、任务数据库、生命周期状态、Lease、Receipt、Checkpoint 或工作流 CLI；Main 依赖宿主原生 Agent 能力，并把长期工程事实留在代码、测试、配置、文档和决策记录中。因此，后续方案讨论首先需要明确**我们想提供哪一级连续性保证**，而不是直接选择存储格式。

建议后续评审依次回答：

1. **保证范围**：只需要同一 Main 上下文被压缩后继续，还是也要覆盖新会话、进程崩溃、宿主更换和人工隔日恢复？
2. **权威来源**：原始用户目标、权限、验收标准与未决问题分别以什么为准？摘要发生冲突时谁优先？
3. **交接最小集**：Subagent 返回 Main 时，哪些字段必须存在——结论、证据位置、变更、未验证假设、失败尝试、风险、下一步？
4. **恢复前核验**：新 Main 是否必须重新读取当前文件、Git 状态、测试和外部对象，而不是直接信任旧摘要？
5. **完成判定**：哪些任务允许 Main 自评完成，哪些必须有确定性测试、独立 Review 或用户确认？
6. **副作用范围**：Skill 是否继续完全依赖宿主的审批、幂等和审计，还是存在宿主无法覆盖的真实需求？
7. **状态冲突**：多个 Agent 共享文件系统时，如何识别陈旧结论、并发覆盖和“摘要基于旧版本”的问题？
8. **数据治理**：如果保存会话、摘要、工具输出或长期记忆，如何处理机密、保留期限、删除、跨项目隔离与反序列化风险？

一个重要边界是：**研究结果支持强化交接与可验证工程事实，但并不自动推导出本 Skill 必须重新引入私有持久化工作流。** 宿主已有能力、任务风险和恢复目标必须先被盘点。

## 10. 后续评测建议

在选择方案前，应该先建立能触发失败的评测，而不是只比较架构图。可设计以下实验矩阵：

| 维度 | 注入方式 | 观察指标 |
| --- | --- | --- |
| **强制压缩** | 在分析、实现、验证三个不同节点压缩 Main 上下文 | 原始目标召回、约束违反、重复工作、完成率 |
| **新 Main 恢复** | 只提供结构化交接；再与完整历史、纯自然语言摘要比较 | 恢复耗时、遗漏、错误假设、无效工具调用 |
| **Subagent 交接** | 删除一项证据、失败路径或未决问题 | Main 是否发现缺口，是否把假设误当结论 |
| **环境变化** | 在交接后修改文件、依赖或测试结果 | 是否重新读取当前世界，是否引用陈旧状态 |
| **副作用重试** | 在工具完成后、回执写入前模拟中断 | 是否发生重复副作用，是否能对账 |
| **长循环漂移** | 加入竞争性局部目标和大量无关输出 | 全局目标遵守率、停滞检测时间、重规划质量 |
| **误判完成** | 保留一项隐藏验收失败 | 自评完成率、测试/Reviewer 捕获率 |
| **并发 Agent** | 两个 Agent 基于不同版本读取和写入 | 冲突发现率、覆盖率、错误合并率 |

至少同时记录质量、token、延迟、人工介入次数和恢复成本。只测最终成功率会掩盖重复调用、陈旧状态和高成本重试。

## 11. 结论

业界资料不支持“上下文耗尽后自动开启新上下文，因此可以自然续接”的强假设。更准确的表述是：

- 宿主可以通过压缩或新会话延长任务，但这引入了一个需要设计和评测的恢复边界；
- 目标漂移可能发生在压缩之前，也可能由不完整摘要、陈旧记忆或错误交接进一步放大；
- 可靠长任务系统倾向于把上下文当作可替换的认知缓存，把目标、决策、进度、证据和副作用当作不同等级的外部状态；
- 对当前 Skill，近期最有价值的研究工作不是立即引入复杂状态机，而是先定义连续性保证、交接契约和可复现的漂移测试。

## 12. 来源总表

| 类别 | 来源 | 本文用途 |
| --- | --- | --- |
| OpenAI | [GPT-5.5 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5) | 长运行 Agent 的压缩与状态保留建议 |
| OpenAI | [GPT-5.2 compaction guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2) | 压缩时机、恢复提示稳定性与不透明边界 |
| OpenAI | [Responses Compact API](https://developers.openai.com/api/reference/java/resources/responses/methods/compact) | 不透明压缩项与 API 语义 |
| Anthropic | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 压缩、笔记、Subagent 的取舍 |
| Anthropic | [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 跨上下文开发失败模式与交接文件 |
| Anthropic | [Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps) | 规划、生成、评估与 session handoff |
| Anthropic | [Claude Code context windows](https://code.claude.com/docs/en/context-window) | 自动/手动压缩的具体产品语义 |
| Microsoft | [Magentic-One](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) | Orchestrator 与外/内层 Ledger |
| Microsoft | [Magentic-One paper](https://www.microsoft.com/en-us/research/wp-content/uploads/2024/11/Magentic-One.pdf) | 停滞检测、重规划和上下文 reset |
| Microsoft | [Agent Framework checkpoints](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) | Checkpoint 捕获范围与持久化 provider |
| Microsoft | [AutoGen state](https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/state.html) | Agent/Team state 保存与加载 |
| Google | [Agent Executor](https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime/) | Event log、snapshot、single writer |
| Google | [ADK state and memory](https://cloud.google.com/blog/topics/developers-practitioners/remember-this-agent-state-and-memory-with-adk) | Session state 与长期 memory 分层 |
| Google Research | [Chain-of-Agents](https://research.google/blog/chain-of-agents-large-language-models-collaborating-on-long-context-tasks/) | 分块长上下文与 manager 汇总 |
| AWS | [AgentCore runtime memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness-memory.html) | 短期事件、长期记忆与截断策略 |
| AWS | [AgentCore memory](https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-agentcore-memory-building-context-aware-agents/) | 记忆类型与 agent state |
| AWS | [Enterprise agent best practices](https://aws.amazon.com/blogs/machine-learning/ai-agents-in-enterprises-best-practices-with-amazon-bedrock-agentcore/) | Handoff 与 trace |
| LangGraph | [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Thread checkpoint 与跨 thread store |
| LangGraph | [Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs) | 子图持久化模式与并发限制 |
| Temporal | [AI reference architecture](https://go.temporal.io/platform-hub/ai-engineering/ai-reference-architecture) | Workflow/Activity 分离与确定性恢复 |
| Restate | [ADK integration](https://adk.dev/integrations/restate/) | Journal、暂停/恢复和工具调用持久化 |
| Manus | [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | 可恢复压缩、文件上下文、目标复述 |
| 论文 | [Lost in the Middle](https://arxiv.org/abs/2307.03172) | 长上下文位置效应 |
| 论文 | [LongMemEval](https://arxiv.org/abs/2410.10813) | 跨会话长期记忆能力与基准 |
| 论文 | [MemGPT](https://arxiv.org/abs/2310.08560) | 分层/虚拟上下文管理 |
| 论文 | [LLMs Get Lost in Multi-Turn Conversation](https://arxiv.org/abs/2505.06120) | 多轮中的早期假设与恢复困难 |
| 论文 | [Evaluating Goal Drift in Language Model Agents](https://ojs.aaai.org/index.php/AIES/article/download/36541/38679) | 竞争目标和长程工具追求中的漂移 |
| 技术报告 | [Chroma Context Rot](https://www.trychroma.com/research/context-rot) | 长度增长下的渐进性能下降 |
| 视频 | [Anthropic: Building more effective AI agents](https://www.youtube.com/watch?v=uhJJgc-0iTQ) | Agent 架构与 context engineering 演讲 |
| 视频 | [Chroma: Context Rot](https://www.youtube.com/watch?v=TUjQuC4ugak) | 技术报告讲解 |
| 视频 | [Sequoia × Boris Cherny](https://www.youtube.com/watch?v=SlGRN8jh2RI) | 长运行编码 Agent 的实践访谈 |
| X | [Andrej Karpathy context engineering post](https://x.com/karpathy/status/1937902205765607626) | 概念与实践问题意识 |
| X | [Boris Cherny workflow thread](https://x.com/bcherny/status/2007179832300581177) | 个人 Agent 工作流案例 |

## 13. 调研限制与更新触发条件

- 多数厂商资料描述自家系统，缺少在同一工程任务、同一模型、同一预算下的横向对照。
- 多数长期记忆论文评估问答或聊天，不覆盖真实仓库、并发编辑、Git、审批和不可逆副作用。
- 模型、上下文窗口和宿主压缩机制更新很快，具体产品语义应在设计前重新核验。
- X 原帖受访问限制；本文没有依赖无法重取的具体措辞或指标。
- 本次调研没有运行当前 Skill 的压缩/恢复实验，因此“对当前 Skill 的启示”仍属于待验证研究假设。

出现以下情况时应更新本文：宿主公开了新的 compaction/resume 契约；当前 Skill 改变“不内置持久状态”的边界；获得本仓库真实长任务漂移数据；或出现覆盖工程 Agent 恢复的新公开 benchmark。
