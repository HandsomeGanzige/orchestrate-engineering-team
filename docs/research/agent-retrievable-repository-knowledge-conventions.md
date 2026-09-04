# 面向新进入编码智能体的仓库知识约定：既有工作与可检验假设

> 本文是截至 **2026-09-04** 的研究材料，不是当前产品行为说明或已接受的设计决策。
>
> 研究问题：结构化作者约定与检索约定，能否让一个没有项目历史记忆的编码智能体更高效、可靠地理解仓库？
>
> 范围：受控词表/标签、需求—架构—代码—测试稳定标识、知识图谱/代码属性图、仓库地图/索引、文档元数据、来源/新鲜度/取代关系，以及仓库级检索与上下文选择基准。
>
> 证据标记：**直接**＝对象就是仓库级检索、追踪或编码智能体；**相邻**＝来自文档标准、软件维护或一般信息检索，需要进一步验证才能迁移到本 Skill。

## 摘要

现有证据最支持的不是“给所有内容多加标签”，而是组合三类机制：**机器可解析且稳定的对象身份与显式关系**、**由语法/引用图自动生成的仓库索引**、以及**带时间和取代语义的少量人工元数据**。需求追踪、代码属性图、Kythe/SCIP 一类代码索引和 Aider repository map 都说明，结构与链接可以缩小候选集；RepoCoder、RepoBench、CrossCodeEval、SWE-bench 等则提供了评价检索和定位的可复用途径。

没有找到足以证明“代码注释中的受控标签本身普遍提高新编码智能体召回率和精确率”的直接对照实验。标签收益高度依赖覆盖率、词表一致性和更新纪律；注释—代码共同演化研究及自动陈旧注释检测工作反而提示：人工重复描述代码事实会产生漂移。因此，更稳妥的研究方向是让标签指向稳定实体/关系、尽量从权威源派生，并把缺失、冲突、陈旧和已取代状态显式纳入排序与评测。

## 研究方法与证据边界

本报告按四个角度组织：

1. 结构化词汇、稳定 ID 与端到端追踪；
2. 图结构、代码索引与仓库地图；
3. 来源、新鲜度和取代；
4. 仓库级检索/上下文选择的基准与指标。

优先引用标准组织、项目官方文档、论文原文入口和原始研究仓库。研究子进程缺少联网工具；随后使用当前宿主可用的 HTTP 能力抽查了 Aider、Kythe、SCIP、Joern、ReqIF、PROV-O、DCMI、ACL Anthology 和相关 arXiv 元数据，并修正了失效链接。此次工作仍不是 2025 年后的系统性文献综述，因此“未发现直接证据”只表示本次检索未发现，不能解释为不存在。

## 主要发现

### 1. 稳定身份与有类型的链接，比自由文本标签有更成熟的依据

1. **ReqIF 把需求交换建模为带标识符的规范对象、属性定义和关系，而非仅靠自然语言标题。** OMG ReqIF 1.2 的目标是跨工具交换需求信息；其对象模型可承载规范对象和 `SpecRelation`。这为 `REQ-* → ADR-* → symbol → test` 一类可验证链路提供了标准先例，但 ReqIF 本身没有证明 LLM 检索增益。**相邻证据。** [OMG ReqIF 1.2](https://www.omg.org/spec/ReqIF/1.2/)
2. **OSLC Requirements Management 明确定义 Web 资源和链接关系。** OSLC RM 2.1 采用 RDF 资源模型，以 URI 标识需求、需求集合及其关系，展示了“稳定 URI + 有类型边”如何支持跨工具导航。对 Git 仓库而言，可借鉴的是身份与关系语义，不一定要采用完整 RDF 栈。**相邻证据。** [OSLC Open Project：Requirements Management 2.1](https://oslc-op.github.io/oslc-specs/specs/rm/requirements-management-spec.html)
3. **PEP/RFC 展示了低技术成本的稳定文档 ID 和取代关系。** PEP 1 规定 PEP 编号和头部字段；RFC 系列以永久编号、状态和 `Obsoletes/Updates` 关系维护长期可引用记录。它们证明稳定 ID 可以通过文本头部和审查流程维护，而非必须依赖专用数据库。**相邻证据。** [PEP 1](https://peps.python.org/pep-0001/)；[RFC Editor 数据库说明](https://www.rfc-editor.org/about/independent/)
4. **SPDX 的价值在于受控语义和可组合身份，而不是“标签越多越好”。** SPDX 3 模型提供元素、命名空间、关系以及创建信息，用于跨工具交换软件物料及来源信息；机器可验证的枚举和关系比自由拼写的 `#security` 更可控。**相邻证据。** [SPDX 3.0.1 Model](https://spdx.github.io/spdx-spec/v3.0.1/model/)
5. **SARIF 展示了稳定规则身份、位置和跨运行关联的工程模式。** SARIF 2.1.0 以 `ruleId`/规则索引、artifact location、result fingerprints 等结构描述分析结果；fingerprint 用于结果在代码移动或多次运行间的匹配。它适合作为“检查结果如何链接到仓库对象”的参考，而不是需求追踪证据。**相邻证据。** [OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)

**对本 Skill 的含义：** 稳定 ID 应当是不可变身份；文件路径、标题和行号只是可变定位信息。关系应使用小而明确的谓词集合，例如 `implements`、`verified_by`、`supersedes`、`generated_from`，而非把所有内容塞进无类型的 `related`。

### 2. 受控标签可改善候选筛选，但缺乏“对编码智能体必然提高准确率”的直接证据

1. **Doxygen 的 groups/topics 是实际存在的人工分类与跨文件聚合机制。** `@defgroup`、`@ingroup` 等命令能把不同文件中的实体组织成模块；这说明受控组名可以建立超越目录结构的入口。Doxygen 文档描述功能，不提供检索 precision/recall 对照。**相邻证据。** [Doxygen Grouping](https://www.doxygen.nl/manual/grouping.html)
2. **Javadoc 标签说明何种元数据适合靠工具约束。** `@since`、`@deprecated`、`@see` 等有固定语义，工具可以渲染或检查；它们优于自由散文中的“旧了”“参见”。但标签覆盖率与真实性仍由作者流程决定。**相邻证据。** [Oracle Javadoc tag specification](https://docs.oracle.com/en/java/javase/21/docs/specs/javadoc/doc-comment-spec.html)
3. **语义代码搜索证明“结构化类型/实体约束”能补充关键词，但不能直接推出注释标签有效。** CodeOntology 将 Java 源码事实映射为 RDF/OWL 并支持 SPARQL 查询，代表用实体类型和关系回答结构化问题的路线。其主要贡献是知识表示与查询，不是新编码智能体上下文选择的随机对照。**相邻证据。** [CodeOntology paper](https://doi.org/10.1007/978-3-319-68288-4_2)；[原始解析器仓库](https://github.com/codeontology/parser)
4. **标签有三种主要噪声机制：同义词分裂、范围漂移、事实复制。** 受控词表只能直接缓解第一类；如果标签范围未定义，`security` 可能表示威胁、控制、所有权或测试类型；如果注释复制实现事实，代码改动后会过时。关于注释不一致，Panthaplackel 等把代码—注释不一致检测建模并发布数据/实现，说明陈旧注释是可观测维护问题。**直接针对陈旧注释，相邻于标签。** [Deep Just-In-Time Inconsistency Detection Between Comments and Source Code](https://aclanthology.org/2021.acl-long.483/)；[原始仓库](https://github.com/panthap2/deep-jit-inconsistency-detection)

**谨慎结论：** 标签在倒排索引中通常会扩大或收窄候选集，但最终 precision/recall 取决于标注质量和查询策略。当前一手证据不足以给出“标签提高 X%”这样的通用量化结论。应将其作为实验假设，而非产品事实。

### 3. 知识图谱/代码属性图适合表达多跳关系，但图构建成本和时效性必须进入设计

1. **代码属性图（CPG）将 AST、CFG 和程序依赖图统一为可查询属性图。** Yamaguchi 等在安全漏洞发现工作中提出这一表示，并用图遍历表达漏洞模式；它直接说明统一图能支持传统文本搜索难以表达的结构查询。论文任务是漏洞发现，而非通用仓库理解。**相邻证据。** [IEEE S&P 2014 论文](https://doi.org/10.1109/SP.2014.44)
2. **Joern 把 CPG 工程化为分层 schema 和查询 DSL。** 官方文档显示节点、边、overlay 与数据流查询可组合；这为 `symbol → call → dataflow → test` 的结构化检索提供实现先例。限制是构图语言支持、增量更新、宏/反射/生成代码准确性。**直接针对代码结构检索，相邻于 agent。** [Joern CPG documentation](https://docs.joern.io/code-property-graph/)；[Joern repository](https://github.com/joernio/joern)
3. **Kythe/SCIP 证明符号级交叉引用可以脱离单一 IDE，成为仓库级索引。** Kythe 将语义事实表示成 nodes/edges，并提供 cross-reference 服务；SCIP 定义语言无关的代码智能索引格式，记录符号、出现位置和文档。两者更适合回答“定义/引用/实现在哪里”，不能单独回答“为什么这样设计”。**直接。** [Kythe Overview](https://kythe.io/docs/kythe-overview.html)；[SCIP specification/repository](https://github.com/sourcegraph/scip)
4. **图不是自动真相源。** 静态分析图可能遗漏动态分派、配置选择和运行时生成关系；人工知识边又可能陈旧。因此每条边至少需要 `source`、生成器/作者、时间或 commit、置信/验证状态，且应区分 `derived` 与 `asserted`。

### 4. 仓库地图证明“小型结构摘要 + 图排序”是实用基线

1. **Aider repository map 是与任务最直接的公开工程先例之一。** 官方文档称其使用 tree-sitter 提取重要类/函数/签名及调用关系，并用基于文件依赖图的排序算法，在 token 预算内向模型提供最相关的仓库地图；地图会随聊天涉及的文件而调整。它支持“结构优先、预算约束、查询相关排序”这一模式，但官方页面不是受控学术评测。**直接。** [Aider repository map](https://aider.chat/docs/repomap.html)；[Aider repository](https://github.com/Aider-AI/aider)
2. **RepoCoder 显式采用检索—生成迭代。** 论文针对仓库级代码补全，用相似代码检索增强生成，并让生成结果继续作为检索查询；结果支持迭代检索有价值，但任务主要是 completion，不等同于 issue 修复或架构理解。**直接。** [RepoCoder paper](https://arxiv.org/abs/2303.12570)；[原始仓库](https://github.com/microsoft/CodeT)
3. **Agentless 把仓库定位拆成层级过程。** 其方法先定位文件、再定位类/函数、最后生成补丁，表明“粗到细候选收缩”可作为端到端软件修复的一部分。论文的整体成功率不能归因于单一地图或标签。**直接。** [Agentless paper](https://arxiv.org/abs/2407.01489)；[原始仓库](https://github.com/OpenAutoCoder/Agentless)
4. **SWE-agent 的 Agent-Computer Interface 强调代理可用的浏览/搜索界面。** 它说明工具接口和反馈格式会影响代理在仓库中的导航；这与作者约定互补：即使知识存在，如果工具不能稳定查找和引用，代理也难利用。**直接。** [SWE-agent paper](https://arxiv.org/abs/2405.15793)；[原始仓库](https://github.com/SWE-agent/SWE-agent)

### 5. 来源、新鲜度和取代关系应该是一等检索信号

1. **W3C PROV 提供实体、活动、代理及派生关系的标准词汇。** `wasDerivedFrom`、`wasGeneratedBy`、`wasAttributedTo` 等可描述“本索引/摘要由何源、何过程生成”；其目标是互操作 provenance，并非专为 Git 仓库设计。**相邻证据。** [W3C PROV-O](https://www.w3.org/TR/prov-o/)
2. **Dublin Core 提供低成本文档级元数据。** `created`、`modified`、`isVersionOf`、`replaces`、`isReplacedBy` 等术语足以形成轻量 front matter 词汇。它们只规定语义，不保证作者按时更新。**相邻证据。** [DCMI Metadata Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/)
3. **仅有 `last_modified` 不等于内容新鲜。** Git 中格式化、移动或批量迁移都可改变文件时间；反之，上游接口已变而文档未修改时，时间戳不会报警。更可靠的 freshness 是相对于依赖对象：记录 `validated_against` commit/schema/API version，并在这些依赖变化时将知识项标为 `suspect`。
4. **取代必须是有向关系且保留历史。** 删除旧文档会破坏外部链接和审计；仅加 `deprecated` 又会让检索同时返回互相冲突的版本。RFC/PEP 模式提示应保留旧 ID，声明 `superseded_by`，默认检索降权旧项但允许追溯。
5. **派生内容应与人工断言分开。** 例如调用边可由索引器重建，`ADR-017 implements REQ-042` 多半需要作者/审查者断言。两类数据应具有不同 TTL、验证方式与冲突策略。

### 6. 可复用基准很多，但真正测“检索是否找对知识”的指标常被端到端分数掩盖

1. **CodeSearchNet 提供自然语言—代码检索数据与基线。** 它适合预训练或评估 NL→函数检索，常用 MRR；但样本主要是函数/文档字符串，不覆盖跨文件架构、测试和需求链。**相邻/局部直接。** [CodeSearchNet paper](https://arxiv.org/abs/1909.09436)；[原始仓库](https://github.com/github/CodeSearchNet)
2. **RepoBench 将评价推进到仓库级。** 它包含 repository-level code completion，并分析不同检索设置；可复用其跨文件上下文任务，但 completion 正确率不能完全衡量设计知识理解。**直接。** [RepoBench paper](https://arxiv.org/abs/2306.03091)；[原始仓库](https://github.com/Leolty/repobench)
3. **CrossCodeEval 专门强调跨文件上下文。** 其多语言 benchmark 构造需要 repository-level context 的代码补全任务，并比较检索设置；适合测索引是否找回外部定义/用法。它仍偏短代码补全。**直接。** [CrossCodeEval paper](https://arxiv.org/abs/2310.11248)；[原始仓库](https://github.com/amazon-science/cceval)
4. **SWE-bench 用真实 GitHub issue 与可执行测试衡量仓库级修复。** 数据实例提供代码库版本、问题文本和隐藏在补丁/测试中的解决标准；它是端到端外部有效性较高的基准，但 pass/fail 无法解释失败源于检索、推理还是编辑。**直接。** [SWE-bench paper](https://arxiv.org/abs/2310.06770)；[官方仓库](https://github.com/SWE-bench/SWE-bench)
5. **需求追踪研究提供更细的 link-recovery 评价框架。** TraceLab 是用于设计和比较软件追踪实验的工作台，体现了以 gold trace matrix 计算 precision、recall 等指标的成熟传统。此类数据通常规模较小、项目年代较旧，迁移到现代 agent 仓库时需重建 oracle。**直接针对追踪，相邻于 agent。** [TraceLab paper](https://doi.org/10.1109/ICSE.2012.6227244)

> 核验说明：TraceLab 论文题名与 DOI 已通过 Crossref 元数据核对；DOI 当前跳转至 IEEE 文档页。该条不作为本报告其他结论的唯一依据。

## 比较表

| 路线 | 典型一手来源 | 最适合回答的问题 | 自动化/维护成本 | 新鲜度风险 | 对 agent 的证据强度 |
|---|---|---|---|---|---|
| 受控注释标签 | Doxygen、Javadoc | “属于哪个模块/状态？” | 低至中；需 lint 和词表治理 | 高：人工标签可漏改、滥用 | 弱；有工具先例，缺直接 agent 对照 |
| 稳定 ID + 类型化追踪 | ReqIF、OSLC RM、PEP/RFC | “需求由什么设计/代码/测试实现？” | 中；需身份、边和完整性检查 | 中；关系可陈旧但可检测 dangling link | 中；追踪成熟，agent 增益待测 |
| 符号索引/交叉引用 | Kythe、SCIP | “定义、引用、实现在哪里？” | 中；可由编译/解析派生 | 低至中；需按 commit 重建 | 强于代码导航，弱于设计意图 |
| 代码属性图 | CPG、Joern | “哪些调用/控制/数据流连接对象？” | 高；语言前端与增量构图复杂 | 中；动态图义可能缺失 | 中；结构查询强，通用 agent 实证有限 |
| token 预算仓库地图 | Aider repo map | “当前问题下最重要的符号/文件是什么？” | 中；解析、图排序、预算裁剪 | 低至中；自动重建可控 | 较强工程证据，独立消融有限 |
| 文档 provenance/freshness | PROV-O、DCMI | “谁/何过程产生？基于什么版本？是否被取代？” | 低至中；依赖 CI 纪律 | 若只靠日期则高；依赖感知可降低 | 弱至中；标准成熟，agent 效果待测 |
| 向量/词法仓库检索 | RepoCoder、CodeSearchNet | “哪些片段与查询语义/词汇相近？” | 中；索引与 embedding 更新 | 中；生成/重命名会影响索引 | 较强，但跨文档关系可能丢失 |
| 层级定位 | Agentless | “先文件、后符号、再编辑点？” | 中 | 随底层索引而定 | 较强端到端证据 |

## 可直接采用的设计模式（不是产品决策）

### A. 最小知识记录（sidecar/front matter）

```yaml
id: ADR-0017                 # 永久身份，不从标题/路径推导
kind: decision               # 受控枚举
status: active               # draft|active|deprecated|superseded
summary: "..."               # 面向检索的短摘要
relations:
  - type: satisfies
    target: REQ-0042
  - type: verified_by
    target: TEST-auth-refresh
superseded_by: null
source:
  commit: 3f2c...
  asserted_by: maintainer
validated_against:
  - src/auth/token.ts@3f2c...
tags: [auth, token-lifecycle] # 辅助 facet，不承担身份/关系语义
```

设计约束：

- `id` 不复用；重命名/移动不改变 ID。
- `kind/status/relation.type/tags` 来自版本化词表；未知值报错而非静默接受。
- `tags` 只表达横切主题；可由 `kind`、路径或关系推导的信息不要重复标。
- 每个可陈旧断言记录来源和验证基线；派生字段注明 generator/version。
- 旧对象保留，使用 `superseded_by`；默认检索排除或降权，但审计模式可见。

### B. 双层索引

1. **确定性层：** 文件、符号、定义/引用、测试收集结果、稳定 ID、显式关系；按 commit 构建。
2. **检索层：** BM25/embedding + 图扩展 + 预算裁剪；先取直接命中，再沿少量白名单边扩一至两跳。

这样既避免纯向量检索漏掉精确 ID，也避免把整张图塞入上下文。输出每个候选的“入选原因”（词法命中、向量相似、被调用、验证某需求、当前有效），便于调试。

### C. 新鲜度状态机

- `fresh`：记录基线与当前依赖一致；
- `suspect`：依赖对象或生成器版本已改变；
- `stale`：检查确认断言不再成立；
- `superseded`：已有明确后继；
- `unknown`：无可验证基线。

排序不能把 `unknown` 当作 `fresh`。CI 可对 dangling target、ID 重复、取代环、词表外标签和 `suspect` 超龄进行不同严重度提示。

### D. 面向上下文的可解释输出

每条送入 agent 的知识片段包含：稳定 ID/符号、来源路径与 commit、状态、入选原因、token 成本、与查询的关系。地图只放签名和摘要；需要时再展开正文（progressive disclosure）。

## 评价方案与指标

### 1. 建立分层 oracle

从一组真实 work item 建立：

- **必要文件集**：完成功能/修复必须查看或修改的文件；
- **必要实体集**：相关符号、需求、ADR、配置、测试；
- **必要链路集**：如 `issue → REQ → ADR → symbol → test`；
- **负例/冲突集**：同词但无关、已取代文档、陈旧注释；
- **最终可执行标准**：测试通过与补丁正确性。

仅把 gold patch 修改文件当作“所有相关上下文”会低估只读依赖、设计文档和失败测试，应由维护者补标，并记录标注者一致性。

### 2. 检索层指标

- `Recall@k`：预算内找回多少必要对象；对于新 agent 通常先防漏召回。
- `Precision@k`：上下文中相关对象比例；衡量噪声。
- `MRR`：第一个关键对象出现多早；适合精确入口。
- `nDCG@k`：必要/有用/背景等分级相关性和顺序。
- **Token-normalized recall**：`必要对象召回数 / 输入 token` 或在固定 token 预算下比较 recall。
- **Trace edge precision/recall/F1**：稳定关系恢复或校验质量。
- **Stale exposure rate**：选中片段中 `stale/superseded` 比例。
- **Conflict rate**：同一查询上下文包含互相冲突且未标状态的断言比例。
- **Explanation accuracy**：系统给出的入选关系是否真实。

### 3. 端到端指标

- SWE-bench 风格 test pass rate / resolved rate；
- 首次正确定位率、达到正确补丁的轮次、工具调用数、延迟和 token 成本；
- 不必要文件读取数、无关编辑数、回滚次数；
- 新鲜度告警的 precision/recall 与维护工时；
- 在固定模型、prompt、工具和随机种子下的配对比较及置信区间。

### 4. 必要消融

至少比较：

1. 词法搜索基线；
2. 词法 + embedding；
3. + 自动符号/引用图；
4. + 稳定 ID/显式关系；
5. + 受控标签；
6. + freshness/supersession 排序；
7. 完整方案。

并做 **metadata shuffle**（打乱标签/关系）和 **stale injection**（让一部分链接、摘要故意落后一至数次提交）。否则端到端提升可能仅来自额外 token，而不是结构语义。

## 可行动、可证伪的假设（非产品决策）

1. **H1：稳定 ID + 类型化边提升跨制品召回。** 在固定 token 预算下，相比路径/关键词基线，显式 `requirement → decision → symbol → test` 链使必要实体 `Recall@k` 提高，同时不显著降低 `Precision@k`。
2. **H2：标签仅在受控且通过 lint 时有正收益。** 封闭词表、定义清楚、每个标签有 owner 的版本优于自由标签；自由标签随时间增加会提高候选数但降低 precision。
3. **H3：自动派生结构比手工重复事实更耐久。** 从 parser/compiler/test collector 生成的 symbol/test 边，在跨提交 stale rate 上低于人工维护的同类注释。
4. **H4：图扩展存在最佳跳数。** 从词法/向量种子沿白名单边扩 1–2 跳可提升 recall；继续扩展会因高连接 hub 导致 precision 和 token efficiency 下降。
5. **H5：显式 supersession 降低错误旧知识暴露。** 对旧设计文档保留 ID、加 `superseded_by` 并默认降权，比删除旧文档或只写 `deprecated` 能同时提高任务成功率和审计可追溯性。
6. **H6：依赖感知 freshness 优于文件修改时间。** `validated_against` 对象变化触发的 suspect 标记，在陈旧知识检测 F1 上高于基于 `git mtime/last commit age` 的规则。
7. **H7：渐进披露优于一次性全图上下文。** 相同 token 预算下，“地图→按需展开”比一次性拼接长摘要获得更高 resolved rate、更低无关读取数。
8. **H8：入选理由改善 agent 自我校正。** 给候选附带确定性 provenance 和关系理由，可减少重复搜索/错误追随旧文档，但可能增加 token；应测净收益。
9. **H9：标签价值集中在非语法语义。** `security-boundary`、`migration-risk` 等无法可靠从 AST 推导的横切标签增益，高于重复 `language:typescript`、`kind:function` 等可自动派生标签。
10. **H10：完整性门禁必须按严重度分层。** 重复 ID/悬空 `supersedes` 应失败；缺少可选 tag 只提示。全量强制会增加规避性/虚假标注并降低真实质量。

## 对标签 recall/precision 与陈旧噪声的专项判断

| 条件 | 预期 recall | 预期 precision | 陈旧/噪声风险 | 原因 |
|---|---:|---:|---:|---|
| 自由标签、无定义 | 可能上升 | 常下降 | 高 | 同义词、歧义、标签泛化 |
| 受控标签、查询做同义扩展 | 上升 | 持平或上升 | 中 | 聚合词形但仍依赖覆盖率 |
| 标签由静态结构自动派生 | 上升 | 较高 | 低至中 | 可按 commit 重建，但分析可能不完备 |
| 标签复制实现状态 | 短期上升 | 随时间下降 | 高 | 事实有两个真相源 |
| 稳定 ID 精确查询 | 对已知实体很高 | 很高 | 低 | 不受重命名影响；前提是链接完整 |
| 图扩展无谓词/跳数限制 | 很高 | 低 | 中 | hub 和弱相关边造成爆炸 |
| freshness/supersession 参与排序 | 有效召回上升 | 上升 | 较低 | 旧项仍可审计但不抢占预算 |

这些是基于上述机制与相邻证据的**预期**，不是已有统一实验结果。必须用仓库自己的任务分布验证。

## 局限与未解决问题

1. **缺少直接标签消融证据。** 已检索到的公开工作多评估检索器、图索引或端到端修复；没有足够的一手研究隔离“受控注释标签”对 fresh coding agent 的因果作用。
2. **基准任务偏代码。** CodeSearchNet/RepoBench/CrossCodeEval 偏补全，SWE-bench 偏 issue 修复；需求、ADR、操作手册与测试之间的多制品理解覆盖不足。
3. **gold context 不唯一。** 同一修复可能有多条有效理解路径，gold patch 也不是完整阅读集合；需要多标注者和分级相关性。
4. **语言与构建系统差异。** Kythe/SCIP/CPG 的覆盖质量受语言、宏、反射、生成代码和 monorepo 构建图影响。
5. **维护行为是核心混杂变量。** 采用规范的团队可能本来就有更好工程实践；应使用同仓库时间切片、随机任务或交叉设计降低选择偏差。
6. **安全与隐私未充分覆盖。** provenance、owner、issue 链接可能泄漏人员或内部系统信息；索引还可能把 secrets 放入 agent 上下文。
7. **来源复核限制。** 本次环境无联网检索工具；应在采纳任何方案前复核 TraceLab DOI、最新规范版本、各 benchmark license/split 和 2025–2026 的新结果。

## 来源取舍

### 保留

- [OMG ReqIF 1.2](https://www.omg.org/spec/ReqIF/1.2/) — 需求对象、属性和关系的正式标准。
- [OSLC Open Project：Requirements Management 2.1](https://oslc-op.github.io/oslc-specs/specs/rm/requirements-management-spec.html) — URI 与 RDF 链接的跨工具需求管理标准。
- [SPDX 3.0.1 Model](https://spdx.github.io/spdx-spec/v3.0.1/model/) — 受控模型、关系与 creation information。
- [W3C PROV-O](https://www.w3.org/TR/prov-o/) 与 [DCMI Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/) — provenance、时间、版本与取代词汇。
- [Kythe](https://kythe.io/docs/kythe-overview.html)、[SCIP](https://github.com/sourcegraph/scip)、[Joern](https://docs.joern.io/code-property-graph/) — 官方结构化代码索引/图实现。
- [Aider repo map](https://aider.chat/docs/repomap.html) — token 预算仓库地图的直接工程实现。
- [RepoCoder](https://arxiv.org/abs/2303.12570)、[RepoBench](https://arxiv.org/abs/2306.03091)、[CrossCodeEval](https://arxiv.org/abs/2310.11248)、[SWE-bench](https://arxiv.org/abs/2310.06770)、[Agentless](https://arxiv.org/abs/2407.01489)、[SWE-agent](https://arxiv.org/abs/2405.15793) — 仓库级检索、定位和端到端评测的一手论文/仓库。
- [ACL 2021 comment-code inconsistency](https://aclanthology.org/2021.acl-long.483/) — 人工注释陈旧风险的直接研究。

### 放弃或未作为核心证据

- 各类“RAG 最佳实践”博客 — 通常没有仓库级 oracle 或可重复消融。
- 厂商对 code search 的营销页面 — 若无索引格式、数据或实验，无法支持精确因果判断。
- 泛知识管理/企业 ontology 案例 — 与代码、测试、commit 新鲜度距离过远。
- 仅报告 SWE-bench 排行的模型公告 — 端到端分数无法隔离 authoring/retrieval convention 的贡献。
- 非官方 ADR 模板合集 — 可提供样例，但稳定 ID、状态与 supersession 的语义不统一；本报告改以 PEP/RFC、ReqIF、OSLC 为主要先例。

## 建议的下一步研究

1. 从本仓库历史中抽取 20–50 个 work item，建立文件/符号/文档/测试四层 oracle。
2. 先实现离线实验，不改作者工作流：基线检索、自动 symbol graph、模拟稳定 ID/关系、模拟 freshness；测固定预算下的增益上限。
3. 再选极小受控词表做双盲标注，测标注一致性（如 Cohen's κ）和每项维护时间。
4. 用跨提交 replay 和 stale injection 衡量 1、5、20 次提交后的质量衰减。
5. 只有在 `Recall@k`、token efficiency、resolved rate 和维护成本共同改善时，才值得把某项约定提升为强制规则。
