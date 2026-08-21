# 调研：多 Agent 工程协作是否必须采用显式持久化状态机？

## 摘要

**不必须。** 业界的一手资料展示了多种协调模型：主管—执行者委派、Agent 交接、顺序/并行/循环工作流、Actor 式消息传递、图执行，以及持久化重放。它们广义上都有“状态”，但只有一部分系统会把严格、持久化的生命周期状态机作为权威模型。

对于工程 Agent，当操作跨越进程故障、工作空间、人工等待或长期外部副作用时，持久化才变得必要。因此，最低限度的安全设计应当是选择性持久化：保存所有权、恢复、审批、副作用去重和审计所必需的事实；让 UI 状态、路由决定、短期对话以及可重算聚合保持临时状态或派生状态。类似 state v3 的协议是高保障设计光谱中的一个有效选择，但不是行业前提。

## 范围与方法

本文只比较厂商官方文档和第一方工程实践报告。标记为“**综合判断**”或“**建议**”的内容，是基于这些资料得到的推论，而不是厂商的原始主张。本调研未修改或执行仓库实现。

## 调研结果

### 1. 显式持久化状态机不是必需条件

1. **Anthropic 展示了有效的主管—执行者系统，但没有把统一持久化工作流状态机作为普遍要求。**

   其研究系统由 Lead Agent 负责规划、向多个并行 Subagent 委派任务并汇总结果。Subagent 在独立上下文中工作，将发现返回给 Lead Agent，还可以动态产生更多工作。Anthropic 重点讨论的是提示词设计、委派、工具设计、Token 成本和可观测性；其协调形态更像动态主管树，而不是固定的 Work Item/Assignment 生命周期。

   Anthropic 还指出：多 Agent 更适合可并行的工作；如果 Agent 需要共享大量上下文或任务间依赖密集，多 Agent 的效果会下降。

   来源：[Anthropic，《How we built our multi-agent research system》](https://www.anthropic.com/engineering/multi-agent-research-system)

2. **OpenAI 提供了多种编排方式，而不是规定一种统一生命周期：**

   - **Manager / agents-as-tools**：一个 Agent 保持控制权，将其他专家 Agent 当作工具调用；
   - **Handoff**：将当前控制权和对话交给另一个专家 Agent；
   - **应用代码编排**：直接使用普通程序控制执行顺序和并发。

   OpenAI Agents SDK 的 tracing 会记录模型生成、工具调用、handoff、guardrail 和自定义事件，但 tracing 属于可观测性，不等于业务协调必须采用严格状态机。

   来源：[多 Agent 编排](https://openai.github.io/openai-agents-python/multi_agent/) · [Handoffs](https://openai.github.io/openai-agents-python/handoffs/) · [Tracing](https://openai.github.io/openai-agents-python/tracing/)

3. **Google ADK 明确区分 LLM 路由和确定性工作流控制。**

   LLM Agent 可以将控制权转交给其他 Agent；Workflow Agent 则提供确定性的 `SequentialAgent`、`ParallelAgent` 和 `LoopAgent`。Agent 通过共享 Session State 交换信息，并可通过 callback/plugin 挂接生命周期事件。

   这属于“有状态”，但工作流可能只是顺序、分叉汇合或循环，而不是覆盖全部领域事实的严格状态迁移协议。

   来源：[Google ADK 多 Agent 系统](https://google.github.io/adk-docs/agents/multi-agents/) · [Workflow Agents](https://google.github.io/adk-docs/agents/workflow-agents/) · [State](https://google.github.io/adk-docs/sessions/state/)

4. **AutoGen Core 使用 Actor/消息传递抽象。**

   Agent 是有状态的，通过消息通信并运行在 Agent Runtime 中。官方模式包括并发 Agent、顺序工作流、群聊、handoff，以及确定性行为和 Agent 自主行为的混合。

   因此，状态机只是可选的应用层逻辑，不是唯一协调原语。AutoGen 同时支持 Agent/Team 状态的保存和加载，说明持久化也可以附加在 Actor 或会话模型之上。

   来源：[Microsoft AutoGen Core](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/index.html) · [设计模式](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/index.html) · [Agent 与 Team 状态](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html)

5. **CrewAI Flows 是带显式状态、路由和可选持久化的事件驱动工作流，但不一定采用单一严格的全局有限状态机。**

   Flow 由事件触发方法组成，例如 `@start`、`@listen`、`@router`，支持结构化或非结构化状态以及状态持久化。这更接近事件图或 reducer 模型：执行根据结果和事件路由，持久化状态负责恢复。

   来源：[CrewAI Flows](https://docs.crewai.com/en/concepts/flows)

**结论：** 当领域不变量依赖合法迁移时，显式状态迁移很有价值；但所调研的业界系统都没有把它视为多 Agent 协作的必备条件。

### 2. 业界采用的主要协调模式

| 模式 | 一手资料中的例子 | 优势 | 成本与失败模式 | 适用场景 |
| --- | --- | --- | --- | --- |
| **主管 / Manager-Worker** | Anthropic Lead Agent；OpenAI agents-as-tools | 中央策略统一；易于汇总；可以动态委派；专家上下文相互隔离 | Manager 可能成为瓶颈和单点；容易重复工作；Token 成本较高 | 任务可动态拆分，并需要单一最终交付负责人 |
| **Handoff / 分散式控制权转移** | OpenAI Handoffs；AutoGen handoff；Google Agent transfer | 专家直接接管后续工作；不必让所有操作都经过 Manager | 全局可见性下降；必须设计上下文移交、终止条件和循环保护 | 会话分诊或阶段性所有权转移 |
| **Actor / 消息传递** | AutoGen Core 路由和广播消息 | 封装性强；适合并发和松耦合；拓扑灵活 | 消息顺序、重复、背压、关联和终止都需要显式处理 | 相对独立、长期运行并异步通信的 Agent/服务 |
| **确定性工作流 / DAG / 分叉汇合 / 循环** | Google 顺序、并行和循环 Agent；AutoGen 顺序及并发模式 | 拓扑可预测；并发有界；依赖和汇合语义清楚 | 适应性较低；纯 DAG 无法自然表达任意修订循环 | 已知的构建、测试、审查流水线 |
| **带 Checkpoint 的图 / 持久化执行** | LangGraph thread、checkpoint、interrupt、replay；Temporal history/replay | 崩溃恢复；暂停继续；人工介入；重放和审计 | 序列化、Schema 迁移、确定性和存储成本较高 | 跨进程故障、长期等待或审批，且必须准确恢复 |
| **事件驱动 Flow / 事件日志 + Reducer** | CrewAI listener/router；Temporal Event History | 追加式审计；可重建状态；便于增加不同投影视图 | Reducer 和事件版本管理复杂；事件会增长；外部副作用仍需幂等 | 重视审计和多视图，且业务天然以命令/事件表达 |
| **共享内存 / 类 Blackboard** | Google ADK Session State；LangGraph Thread State | 信息交换简单；提供共同工作上下文 | 写冲突、陈旧数据、隐式耦合和上下文膨胀；本身不解决所有权 | 小团队或写入受控、事实可安全合并的任务 |
| **严格领域状态机** | 可由图/工作流框架中的应用逻辑实现；Temporal Workflow 也可编码 | 合法迁移与 Gate 清晰；容易执行不变量；生命周期可审计 | 容易出现迁移爆炸；偶然信息会变成协议；修订与重试组合脆弱 | 合规、高保障审批、稀缺资源 Claim 和不可逆副作用 |

上表中的“类 Blackboard”属于**综合判断**：官方文档描述的是共享 Session/Thread State，不一定明确采用经典 AI Blackboard 架构。

### 3. 什么需求会迫使系统持久化？

#### 强烈需要持久化的情况

- **崩溃后必须继续，而不是从头重启。**

  LangGraph 会按 Thread ID 在执行步骤处保存图状态，用于容错和重放。其 Durable Execution 文档特别指出：恢复时可能从适当的起点重新执行，因此副作用和非确定性操作必须隔离并具备幂等性。

  来源：[LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) · [Durable Execution](https://docs.langchain.com/oss/python/langgraph/durable-execution)

- **执行需要等待人工或外部事件。**

  LangGraph Interrupt 会保存状态，使执行能够暂停和恢复；Temporal 通过 Event History 保存 Workflow 状态，并通过确定性重放恢复执行。

  来源：[LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) · [Temporal Durable Execution](https://docs.temporal.io/temporal#durable-execution)

- **外部副作用必须在重试中保持安全。**

  Temporal 将确定性 Workflow 逻辑与 Activity 分离。Activity 承载可能失败或非确定性的外部操作，并根据策略重试；幂等性用于防止重试产生重复副作用。

  来源：[Temporal Activities](https://docs.temporal.io/activities) · [Activity 幂等性](https://docs.temporal.io/activity-definition#idempotency)

- **跨进程维持排他所有权或稀缺资源 Claim。**

  **综合判断：** 文件、Workspace、Merge Lease 或审批令牌不能只存在某个 Agent 的上下文中。如果其他进程需要在崩溃后继续观察并强制执行，就必须存放在具备原子冲突控制的权威存储中。单纯的人类可读状态字段不足以实现排他性。

- **需要审计或复现。**

  OpenAI Trace 提供 Agent Run 的可观测性；LangGraph Checkpoint 和 Temporal History 可以重建执行状态。仅需要诊断证据时，Trace 可能足够；需要操作性恢复时，则必须采用 Checkpoint/History。

- **工作跨越部署或长期保存。**

  一旦执行状态必须跨版本恢复，持久化 Schema 和版本兼容性就成为产品契约。

#### 通常可以采用临时编排的情况

- 操作持续时间短，能够低成本、安全地从持久化输入重新开始；
- 没有获取排他 Claim，也没有执行对外可见的副作用；
- 不存在人工审批或等待边界；
- 结果只是建议，或者可以确定性重算；
- 所有 Agent 都由一个进程管理，并允许丢失中间对话。

**综合判断：** 是否需要持久化由恢复目标和不变量决定，而不是由 Agent 数量决定。单 Agent 部署流程可能需要强持久化；十个 Agent 的头脑风暴可能只需保存最终文档。

### 4. “有状态”不等于“所有内容都是严格状态机”

应区分以下概念：

- **工作状态**：消息、模型上下文、中间笔记、工具输出、计数器和当前图值；
- **持久化事实**：已接受 Artifact、不可变 Receipt、审批决定、Claim/Lease、外部副作用标识以及 Commit/Workspace 身份；
- **派生状态**：由持久化事实计算出来的 ready、进度、活跃 Assignment 和 Gate 摘要；
- **控制状态**：当前图节点、活跃 Agent、重试次数或 continuation token；
- **领域状态机**：一组明确的业务状态、合法迁移和 Guard。

LangGraph 持久化 Thread 的图快照；Google ADK 暴露 Session State；AutoGen Agent/Team 可以保存状态；OpenAI 通过 Manager 或 Handoff 传递对话和控制权。这些机制都不意味着每个事实必须成为统一生命周期中的一次受保护迁移。

反过来，Temporal 表明：即使应用代码写成普通命令式流程，运行时仍然可以通过重放实现持久化。持久化是运行时能力，严格领域状态机则是建模选择。

来源：[Temporal Workflow Execution](https://docs.temporal.io/workflow-execution) · [Event History](https://docs.temporal.io/workflow-execution/event)

### 5. 本仓库采用的架构决策

> **决策说明：** 本节记录调研之后已经采纳的产品方向，并替代调研阶段曾考虑的“事件日志 + Reducer + 小型状态机”仓库内实现建议。

本仓库决定不再内置任何工作流状态运行时。Main 直接使用宿主提供的原生 Subagent 能力，根据当前上下文自主选择专家、顺序、并发方式、证据和完成时机。仓库不提供：

- `.agent-work` 或 `state.json`；
- Work Item/Assignment/Attempt 状态数据库；
- Lease、Claim、Revision、Receipt 或质量 Gate；
- 事件日志、Reducer、Checkpoint 或持久化 DAG；
- 要求 Main 调用的工作流 CLI。

这一决策不是否认持久化在高保障系统中的价值，而是明确**职责边界**：

1. **Agent 认知与调度由 Main 负责。** 多 Agent 的价值是独立上下文、领域专业性、替代判断和有意义的并发，而不是满足固定角色流水线。
2. **运行时安全由宿主负责。** 如果任务需要跨会话恢复、Worktree 隔离、并发写保护、人工暂停、Trace 或持久化执行，应使用宿主平台已经提供的 Session、Mission、Sandbox、Worktree、Checkpoint 或审批能力。Skill 不复制这些设施。
3. **工程事实由项目承载。** 长期有效的决定、需求、测试证据和交付结果应进入代码、测试、配置、文档、Issue、PR 或 ADR，而不是进入 Skill 私有状态。
4. **不可逆操作仍由用户确认。** Main 在涉及权限、发布、购买、生产修改或明确风险接受时直接询问用户，不通过本地 Gate 状态机模拟授权。
5. **简单工作保持简单。** 如果一个 Agent 可以清楚、安全地完成任务，就退出多 Agent 编排；不为分工而分工。

如果未来某个宿主缺少任务所必需的持久化或隔离能力，正确行为是说明限制、调整执行方式或停止相关操作，而不是重新在本 Skill 中构建半套工作流引擎。

### 6. 工程 Agent 场景中的特殊问题

以下是工程 Agent 系统普遍需要考虑的问题；在本仓库已经采用的方案中，这些运行时责任应交给宿主平台，而不是由 Skill 脚本实现。

- **并发 Workspace 编辑**

  上下文隔离不等于文件系统隔离。每个可写 Assignment 应拥有独立 Worktree/Sandbox，并记录基础与结果 Commit。Claim 用于不可安全合并的资源；可合并文件可以采用乐观合并加测试。

- **所有权与 Claim**

  使用原子 Compare-and-Set 或事务性 Lease。应定义过期、续租、Fencing Token 和陈旧 Owner 恢复，否则崩溃 Owner 可能永久阻塞工作，或者被替换后重新出现并覆盖新结果。

- **质量 Gate**

  持久化决定和证据，而不是只保存 `passed`。Evidence 应绑定 Artifact/Commit Hash，使后续改动能够使旧 Gate 失效或被新证据替代。确定性测试可以是 DAG 节点，主观 Review 可以是 Interrupt/Approval。

- **崩溃恢复**

  只在有意义的边界保存 Checkpoint。恢复时必须区分纯计算/可重放步骤与外部副作用。不能静默重复不可逆的 Prompt/Tool 操作。

- **人工审批**

  Pause/Resume 必须持久化；审批者应经过认证；应记录批准的精确 Artifact 与 Scope；拒绝和修订应追加为新事件，而不是改写历史。

- **幂等与重试**

  为 Tool/CLI 副作用分配稳定幂等键；记录开始与完成；区分可重试和永久错误；限制重试次数与退避。跨外部系统不应假设“严格执行一次”，而应实现幂等或对账。

- **可观测性**

  关联 Work Item、Assignment、Run、Trace/Span、Tool Call、Commit 和 Event ID。OpenAI Tracing 是运行可见性的示例，但 Trace 不应成为操作真相或授权依据。

- **上下文隔离**

  只给专家传递最小、明确范围的任务和 Artifact 引用。持久化决定与产出，不持久化隐藏的 Chain-of-Thought。Anthropic 的实践表明，独立上下文有利于并行并缓解单一上下文瓶颈，但紧密耦合的任务并不适合并行多 Agent。

## 对问题的直接回答

1. **是否必须使用显式状态机？**

   不必须。状态不可避免，但不需要一个覆盖全部事实的持久化领域状态机。

2. **业界有哪些模式？**

   主管—执行者、handoff、Actor/消息传递、顺序/并行/循环图、共享 Session State、事件驱动 Flow、Checkpoint/Replay Runtime，以及用户自行定义的严格迁移。选择取决于任务耦合度、拓扑稳定性、恢复要求、审计要求和副作用。

3. **什么情况迫使持久化？**

   跨崩溃或部署恢复、人工/外部等待、排他所有权、不可安全重复的副作用、审批与审计以及长时间执行。可低成本重启的建议性工作可以保持临时状态。

4. **状态与状态机有什么区别？**

   Checkpoint、Session Dictionary、消息历史、Trace 和事件日志都有状态，但不要求每个领域事实都通过受保护的生命周期迁移产生。

5. **本仓库最终采用什么方向？**

   不再内置状态数据库、事件日志、Reducer、DAG 运行时或严格状态机。Main 通过宿主原生 Subagent 能力自主调度；需要的 Session、隔离、Checkpoint、审批和审计能力由宿主提供；长期工程事实进入项目的代码、测试、文档、Issue、PR 或 ADR。

## 来源表

| 官方或第一方来源 | 使用的证据 | 保留原因 |
| --- | --- | --- |
| [Anthropic：How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Lead/Subagent 架构、并行上下文、委派、可观测性及适用边界 | 生产多 Agent 系统的第一方工程报告 |
| [OpenAI Agents SDK：Multi-agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/) | Manager-as-tools、Handoff、代码编排 | 官方 SDK 设计指导 |
| [OpenAI Agents SDK：Handoffs](https://openai.github.io/openai-agents-python/handoffs/) | 控制权和上下文转移 | 官方原语文档 |
| [OpenAI Agents SDK：Tracing](https://openai.github.io/openai-agents-python/tracing/) | Trace Span/Event 与可观测性范围 | 用于区分诊断信息和持久化控制状态 |
| [LangGraph：Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Thread、Checkpoint、重放与容错 | 官方持久化语义 |
| [LangGraph：Durable Execution](https://docs.langchain.com/oss/python/langgraph/durable-execution) | 重放、确定性和副作用幂等 | 官方恢复约束 |
| [LangGraph：Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) | 持久化暂停/恢复及 Human-in-the-loop | 官方长期交互原语 |
| [Microsoft AutoGen Core](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/index.html) 与 [Design Patterns](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/design-patterns/index.html) | 有状态 Actor、消息、并发/顺序/群聊/Handoff | 全局工作流状态模型之外的官方方案 |
| [Microsoft AutoGen：Agent and Team State](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html) | 状态保存与加载 | 说明持久化可附加到 Agent/Team 模型 |
| [Google ADK：Multi-agent systems](https://google.github.io/adk-docs/agents/multi-agents/) 与 [Workflow agents](https://google.github.io/adk-docs/agents/workflow-agents/) | Transfer、层级、顺序/并行/循环控制 | 区分 Agent 自主路由和确定性控制 |
| [Google ADK：State](https://google.github.io/adk-docs/sessions/state/) | 共享 Session State | 证明共享状态不等于严格生命周期状态机 |
| [CrewAI：Flows](https://docs.crewai.com/en/concepts/flows) | Event Listener/Router、State 和 Persistence | 官方事件驱动替代方案 |
| [Temporal：Durable Execution](https://docs.temporal.io/temporal#durable-execution)、[Workflow Execution](https://docs.temporal.io/workflow-execution)、[Event History](https://docs.temporal.io/workflow-execution/event) | 持久化重放和 History 模型 | 高可信的非 Agent 工作流参照 |
| [Temporal：Activities](https://docs.temporal.io/activities) 与 [Idempotency](https://docs.temporal.io/activity-definition#idempotency) | 副作用边界、重试和幂等 | 支撑恢复建议 |

### 未采用的来源

- 第三方博客、对比页面、Benchmark 摘要和 SEO 内容：不符合一手资料要求；
- 经典 Blackboard/Actor 论文：无需借助这些资料即可确认厂商模式；本文将“类 Blackboard”明确标记为综合判断；
- Semantic Kernel 编排：任务允许在 Microsoft AutoGen 与 Semantic Kernel 中择一；AutoGen 官方文档已直接覆盖 Actor/消息型多 Agent 协调。

## 空白与残余风险

- 这些资料描述的是框架语义和少量生产实践，不包含受控对比实验，无法证明某一种协调架构对软件工程 Agent 普遍更优；
- 厂商文档会变化。将本调研转化为架构决策前，应重新确认 URL 和具体 API；
- Anthropic 的研究任务比并发代码编辑更易并行且更偏只读。关于 Worktree、Claim 和 Merge Gate 的建议属于工程综合判断，不是 Anthropic 的原始结论；
- 没有任何来源给出一个通用阈值，例如 Agent 数量、执行时长或成本达到多少就必须持久化。正确阈值取决于恢复目标、重复副作用的后果和审计要求。
