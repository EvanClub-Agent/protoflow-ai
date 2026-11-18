# AI 限流恢复与上下文完整性方案

状态：2026-11-13 已实现并通过本地验证；配套诊断 API 与管理页面已部署到 104（`20261113-165753-diagnostics-recovery`）。桌面限流恢复和候选保留需由维护者打包、更新客户端后生效，本次没有替换桌面安装包或正在运行的 Hermes。诊断增强与自动恢复是两个不同能力。

## 已确认的参考依据

- [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：HTTP 请求重试、SSE 中断重试与自动压缩阈值分别配置。不能将这些机制视为同一种“失败后重新生成”。公开文档不证明桌面产品的全部内部实现，也不承诺摘要无损或零幻觉。
- [OpenAI 限流规范](https://developers.openai.com/api/docs/guides/rate-limits)：遵守有效 Retry-After 下限；无有效服务提示时指数退避并加入随机延迟；限制尝试次数与总等待预算，避免 SDK 与宿主叠加重试；已经消费流式输出时不能盲目重放请求。额度/账单耗尽与临时限流须分开处理。
- [OpenAI 上下文压缩](https://developers.openai.com/api/docs/guides/compaction)：原生压缩窗口携带后续推理所需状态；独立 compact 接口返回的完整窗口应原样传递。它不能等同于客户端自行生成的一段摘要，也不能未经兼容性验证套用于 Hermes 当前的其他协议。

本方案借鉴上述公开机制，补充本项目的工程约束。未声称已验证 Codex 闭源桌面层的具体实现。

## 104 现场和源码复核

这次 session/prompt 返回 -32603，真实上游为 TPM 限流。每分钟限额 1,000,000，窗口已用 625,675，本次请求计量 440,588，最后一次建议等待 3.976 秒；219 条消息、Hermes 估算 514,092 Token。这些计量含义不能合并为“真实输入 Token 数”。

104 的 Hermes 原生 `agent/retry_utils.py::provider_retry_after_seconds` 只读取响应头 Retry-After 和结构化 retry_after，未将本次正文中的 `Please try again in Ns` 用作等待下限；`agent/turn_recovery.py::compute_error_backoff` 无该值时走普通退避，且会把超过上限的服务等待时间向下截断。两处都应修正。此处是已检查代码的缺口；并未从旧日志反推出当时完整的 HTTP 响应头。

修复前 Alex 的恢复边界：`electron/hermes-runtime.cjs::execute` 收到异常后不会返回候选操作，finally 将 context.json 写成 inactive 并清空 operations。`src/services/projectWorkflow.ts` 的 continuation 主要处理“模型已正常返回，但宿主验收未通过”。本次增加独立的持久草稿恢复，不能把聊天历史保留等同于草稿完整保留。

## 已实现的边界与运维方式

- `electron/hermes-rate-limit.py` 在原生单次 provider 请求内部重试，同一个请求对象传回同一个 provider 调用函数，最多 6 次调用。自动恢复窗口为 180 秒，从首次请求开始按单调时钟计算；预算不足以满足服务等待下限时直接保留现场，不缩短下限。该窗口不强行截断已经发出的 HTTP 请求。SDK 重试配置必须明确为 0，否则不叠加重试。
- 限流等待每 200ms 检查取消与精确 runId/sessionId；等待结束再次核对。压缩后的物理 sessionId 通过 Hermes 原生数据库谱系解析到原逻辑会话，不按标题或相似 ID 匹配。
- 运行时适配生成在应用数据目录的 `native-recovery/`，校验已支持源码和副本修改文件的 SHA-256；原安装源码不覆盖，启动器不共享。依赖使用原安装已发布的环境，未识别版本明确拒绝连接。运行中的 Gateway 必须回报相符的策略及本地恢复通道指纹，不能只检查 ACP 启动文件。
- 已有 Gateway 只有在同一 home、非独立服务管理、实时确认无任务时才允许切换。切换先使用原生外部 drain 暂停接收新任务，再核对 PID 和实时任务数；有任务进入则撤销自己的 drain，保留现有任务。未使用 `--yes`/强制停止；其他维护标记不覆盖。独立服务需要维护窗口单独部署。
- **持久候选恢复当前覆盖项目 `generating` 阶段**。其他类型任务也使用请求级限流等待，但没有新增跨重启的候选自动恢复。恢复文件位于原会话目录的 `recovery-<阶段与目标页摘要>.json`，包含原始任务与图片引用、候选快照、待提交操作、需求核对记录、初始基线及精确身份；不上传这些文件。
- MCP 同步事务和宿主冻结使用相同跨进程锁；锁只覆盖同步读写，不跨桥接等待。结束先冻结，再验证最终结果，拒绝迟到回调。逐页保存成功后按精确 runId 标记已提交；标记失败不撤销已成功保存的工程，工程版本校验仍阻止重放。
- 正常失败留下可验证候选，原账号、工程、会话、模型及契约均一致时，点击“继续此页”装载一次并增量修复。账号或服务地址、工程/需求、模型、指令/物料契约变化则拒绝自动覆盖。每轮仍执行 brief 重读、实时 compressions 核验、`verify_prompt` 和完整验收。
- 已有部分流输出、原生工具终态未确认、崩溃留下的在途轮次均标记为 `uncertain`，保留草稿但不自动恢复。用户可以选择“保留旧草稿，重新生成”，将旧候选归档后从当前真实工程开始；不会拿未知状态冒充成功。
- 已接管 OpenAI 兼容聊天流内部的重试与部分响应替代逻辑：断流结果不再伪装成输出长度不足而自动续写。没有 HTTP 拒绝证据的连接异常停止自动重放，保存为结果待核对状态；不把未知处理状态当作请求未执行。
- Responses 路径另外校验 `agent/codex_runtime.py` 的源码摘要，接管其物理重试预算。只对尚无输出、推理或工具项的显式限流错误帧（含 SDK 在 SSE 迭代期间抛出的确切 `APIError`）等待重试；不把 HTTP 200 的错误帧伪记为 HTTP 429。原始事件及重试请求保持不变，禁止原生零事件重试削减工具结果。EOF、部分输出或不确定的失败输出仍停止自动重放。
- 恢复过程没有新增摘要、清空历史、切换模型/账号，也不降低验收规则。无法承诺消除模型本身的幻觉；可以验证恢复路径不通过删减上下文或猜测业务字段来换取成功。

回滚时应先让任务结束，再停止本次适配的空闲 Gateway，使用原 Hermes 启动器重新启动，并回滚桌面安装包。原 Hermes 源码不需要恢复；本地候选记录和旧副本保留，不自动删除用户草稿。发布顺序为诊断后端白名单、管理页面、新桌面包；版本号仍由发行维护者确定。

## 第一阶段：原上下文等待重试，不改变压缩策略

1. 修复位置在 Hermes 的单次模型请求恢复层，发生在整轮任务退出之前。等待时保留当前会话、消息、工具调用及结果、暂存快照和原始任务要求。不要在 Alex 的 `session/prompt` 外层简单套自动重跑。
2. 优先消费结构化 HTTP 状态、错误 code、Retry-After/重置时间和 retry_after。兼容本次代理包装错误时，只对已确认临时限流的提供商错误体，使用受限的 `Please try again in <number><unit>` 解析；不从模型正文、项目内容或历史日志驱动自动重试。
3. 重试前至少等到服务允许的时刻，可增加随机延迟，不能用本地等待上限把服务下限缩短。没有有效下限才采用指数退避。长于总预算则保留现场并结束本次自动等待。使用单调时钟计算等待，支持及时取消。
4. 只重试明确未获模型接受的请求，保留原请求内容。已产生部分流输出、工具执行结果不明、连接断开但服务处理状态未知时，不自动重放写入；先核实原任务终态与已完成操作。账单不足、认证、参数错误不进入临时限流重试。
5. 重试次数与总耗时由一个策略负责，并计入 SDK 内部尝试，避免相乘。不能通过后台切换账号、模型或服务来隐式改变用户选择。
6. UI 展示“模型服务限流，等待恢复”、等待进度及停止入口；等待文案是状态事件，不混入模型对话或系统提示。日志记录原因、服务建议下限、实际等待、尝试次数和恢复结果。

Hermes 是独立运行时，修改 Alex 的错误文案不足以生效。落地应采用可版本校验、可回滚且经过测试的原生修复；不能靠任意导入时猴子补丁或无条件覆盖用户的 Hermes 安装。当前正在运行的任务不能被热替换或重启。

## 第二阶段：终止后可验证的草稿恢复

自动等待仍可能耗尽。此时先封闭旧轮次写入口，确认/收束该轮 MCP 在途调用，再原子保存本地恢复记录，随后清理运行态。恢复记录属于本地工程数据，不进入远程诊断日志。

恢复记录至少包含：

- 精确 projectId、会话作用域、threadId、targetPageId、workflowPhase、sessionId、原 runId、模型及 Hermes 环境身份。
- 起始工程修订版本、确认的需求/约定与方案版本、物料契约和系统指令摘要。
- 当前合法候选页面、表/字段/关联与演示数据快照，尚未提交的操作及需求证据，已完成和待完成工作。
- 原始需求和最近修订的可检索来源，不把模型推测改写成用户确认的事实。

恢复时校验工程、账号及环境作用域，重新读取真实工程状态。基线版本已变化时拒绝自动覆盖，不按标题/表名猜测 ID。已提交页不得再次执行；暂存操作在新轮次只能被正确装载一次。新轮次使用新的 runId，旧异步回调继续由执行身份围栏拒绝。最终仍通过物料、关联、动作、需求与逐页落盘检查后才能宣称完成。

## 长上下文与幻觉约束

临时 TPM 限流不触发额外的自动压缩、清空历史、新建空会话或降低验收标准。先通过等待机制修复本次失败链路，再单独评估长会话输入量。

需要调整压缩策略时，原始需求、用户修订和项目事实必须有可检索的持久来源；摘要只用于导航与延续，不取代权威工程状态。表/列/页面标识、外键、已确认规则和未完成验收项从实际项目读取，不允许模型补猜。保留现有写前实时 compressions 检查、brief 重读门禁和每轮 verify_prompt；覆盖指令被截断/拦截，以及压缩事件尚未写入宿主文件的时间窗。

模型本身的幻觉不能被承诺完全消除，压缩也不能声称数学意义上的语义无损。可以验收的是：限流恢复路径不额外删改上下文、工程事实不靠摘要重建、恢复身份准确、写操作不重复、结果仍经宿主校验。单请求本身已超过服务允许的容量时，单纯等待无法解决，应明确停止并保留现场，再评估压缩或服务容量。

## 发布前必须通过的场景

| 场景 | 必须满足的断言 |
| --- | --- |
| 返回 Retry-After 或正文限流等待后恢复 | 实际等待不少于服务要求；重试前后消息、工具结果及项目快照一致；同一工具写入不重放 |
| 等待超过预算 / 连续限流 | 不提前重试，不无限循环；候选草稿有完整恢复记录 |
| 等待期间取消或切换项目/账号 | 停止重试；迟到结果不能写入其他轮次或工程 |
| 部分流输出或工具执行后断线 | 不把整轮当作未执行；核对已完成动作，无法确定则停止自动恢复 |
| 重启应用后继续 | 恢复原任务与候选状态，不重复建表、写演示数据或覆盖已完成页面 |
| 恢复前工程被手动修改 | 检出修订冲突，不用旧快照静默覆盖 |
| 压缩后继续生成 | 实时压缩围栏、brief 门禁、verify_prompt 和最终验收全部仍生效 |
| 系统指令截断/安全拦截、表关联缺失 | 显式失败，不通过降级规则或推测关联获得假成功 |

测试应包含本次 104 错误的脱敏固定样例、可控制时间与响应的模拟服务，以及恢复前后工程状态/工具执行次数断言。真实模型验证需另行记录请求计量、实际等待和是否恢复，不能用模拟测试宣称生产成功率。

## 本地验证记录（2026-11-13）

- `npm test`：448 项通过，0 失败、0 跳过。其中请求策略与 Gateway 保护测试运行 24 个 Python 用例；覆盖实际 3.976s 正文提示、请求内容不变、等待下限、预算、取消边界、压缩会话谱系、额度错误及不确定断流。
- 真实 Hermes v0.23.1 进程 + 本地 HTTP/SSE 模拟服务：先 429，再成功；实际间隔不少于服务要求的 1.1 秒，两次请求完整 JSON 相同。同一会话热更新项目规则并通过 `verify_prompt`；随后模拟 SSE 提前结束，确认只请求一次且明确失败，未自动续写。
- 真实 MCP + 主进程恢复：重启后候选装载一次、brief 门禁重置、最终提交确认、工程/账号/模型/契约冲突、跨进程冻结、显式归档重建、保留原始任务证据。
- 隔离 Hermes home 的真实空闲 Gateway 切换与策略/通道指纹验证通过；原安装启动器与源码保持独立。活动任务、维护标记、服务管理和切换竞态另有受控回归测试。
- 主程序与 viewer 构建通过；Go 服务 `go test ./...` 与 `go vet ./...` 通过；Python 语法与 `git diff --check` 通过。构建仍有已有的大包体积警告。
- 本轮未调用付费模型，未修改 104 正在运行的任务、桌面安装包或发行版本。真实模型恢复率与 Linux 发布包验收需在维护窗口升级后补测；其他 provider 协议尚未进行同等端到端验证。

## 配套服务发布记录（2026-11-13 17:01）

- 104 已部署诊断字段白名单、账号/电脑/runId 查询及管理页面；数据库保持 schema 10，无新增迁移。原有 5 个版本、5 个安装包、30 条分享及账号记录的摘要校验一致。
- 线上验收样例 `2a759a63-c7b8-473f-9665-0cf1bc8ab8e4` 明确标识为部署测试。验证了账号、设备、根因、`providerRetryCount`、`providerWaitMs` 入库、重复上传去重、未知指标拒收、匿名查询拒绝，以及后台组合筛选与同一任务关联查询。该样例不代表真实模型恢复成功。
- 原有公开移动分享可以直接打开、切换页面并查看单据详情；官网代理的版本数据与发行中心一致，最新已发布版本仍为维护者发布的 `0.1.0`。
- 后续由维护者打包桌面端并更新 104 测试。当前客户端版本号未调整；本次不升级或重启 104 的桌面端/Gateway。备份和回滚信息见 [部署记录](publishing-deployment.json)。

## 0.1.0 更新后的 Responses 路径复核（2026-11-13）

104 在 17:08:24 上报 `69dbc1fe-9858-49dc-8ca4-f973df7a736b`，准确记录了账号、设备、runId 及 `request-outcome-unknown`，但原始 SDK 错误码被旧策略包装后未保留。随后 17:10 的两次失败来自 `validateCheckpoint` 对 `uncertain` 草稿的拦截，耗时约 14–15ms，尚未请求模型。原恢复文件仍存在，记录 0 条候选写操作；这不等于可以证明旧请求全部无副作用，排查没有修改该文件或生产会话。

原生日志证明现场走的是 `codex_responses`，此前的真实 HTTP 验收主要覆盖 `chat_completions`，遗漏了 Responses 自有的物理重试循环和 SDK SSE 错误入口。新增真实 Hermes/OpenAI SDK/本地 HTTP 测试可以验证该缺口：流内限流事件及 `response.failed` 进入等待后成功；额度不足、部分文本/工具输出与无终态 EOF 不重复请求。旧现场的原始错误对象已丢失，不能从请求量或时间相近推断这次必然仍是 TPM 限流。

104 的隔离对照进一步复现了旧适配的具体缺陷：同一个无输出 SSE `error` 包装由真实 SDK 抛出 `APIError` 后，被旧适配判为 `request-outcome-unknown`，没有进入限流等待；新适配在相同模拟响应下等待并成功。macOS 和 104 Linux 的真实 Hermes/SDK 均通过 7 个 HTTP/SSE 场景，覆盖 SDK 错误包装、显式错误事件、失败终态、额度、部分文本、部分工具和 EOF。449 项回归复跑全部通过，主程序构建通过。首次全量回归中的旧计时用例出现 39.56ms 超过 30ms 阈值的波动，未修改断言，复跑通过。

修复同时将允许的服务错误码、错误帧来源和异常类型保留为 `provider-response` / `provider-exception` 检查项，将数值限流证据保留在 `context.failure`。草稿校验明确提示现有的“保留旧草稿，重新生成”入口，诊断保留 `uncertain` 状态，不再误报草稿不存在。该入口先归档旧候选，再按当前真实工程生成，保留原会话历史。

运行 `node scripts/hermes-responses-recovery-smoke.cjs [Hermes源码目录]` 可复验；使用隔离 Hermes home、本地模拟服务和测试凭证，不调用付费模型，不操作用户工程。参考 [Responses 错误事件](https://developers.openai.com/api/reference/resources/responses/streaming-events) 与 [限流恢复规范](https://developers.openai.com/api/docs/guides/rate-limits)。本次修复在桌面运行时；服务端已支持这些既有诊断字段，无需新增迁移，需重新打包客户端后现场复测。

## 0.1.1 重启后恢复基线误报（2026-11-13 17:32）

104 记录 `5fbf53c8-849f-40a3-9f69-6db0ad5fd0cc` / `9c2d9756-ef04-49da-9b65-8554f1f1837f`，耗时 11.29 / 10.79ms，`acpTurnMs=0`。这次未调用模型。现场保存工程与旧候选的页面源码、数据库结构、表数据、需求及生成进度一致，仅宿主失败说明不同。用现场数据重新计算原基线摘要，精确匹配到旧算法排除了 `t_school` 的预览初始化行。

根因：`projectRevision()` 为运行中冲突检查忽略尚未被修改的自动预览行，其来源标记位于 WeakMap。文件保存包含这些行，重启加载后 WeakMap 标记消失，行被计入工程版本。把该内存版本直接用于持久恢复，造成未修改工程也被判为冲突。

修正：持久恢复单独使用 v2 基线，包含起始工程实际保存的完整表数据及原始笔记，只排除宿主失败说明；运行中的 `projectRevision()` 保持原有语义。新草稿保存分项摘要，诊断通过既有 `checks` 字段记录冲突项、原草稿 runId 与实际保留状态，不上传工程内容。旧版基线无法从修改后的候选反推，明确提示升级兼容问题并保留原文件，不静默迁移或删除。现场旧候选还处于 `uncertain`，需要已有的“保留旧草稿，重新生成”流程，不因修复基线误报而放行未知结果重放。

新增回归覆盖：自动预览行的真实文件编解码/重新加载；批量“继续剩余页面”入口；真实数据、页面、需求和笔记修改仍失效；v2 冲突分项诊断；旧版不确定候选保持原字节且不请求模型。本次为桌面代码修改，既有服务器诊断协议可接收这些字段，无新增数据库迁移。

验证结果：452 项全量回归通过，0 失败、0 跳过；主程序构建和 Node 语法检查通过，保留已有大包体积警告。104 原恢复记录仍为 17:08:24 的 `uncertain` 候选，排查未改动其内容。桌面端需由维护者重新打包并现场验证，本次未调整维护者已设定的 `0.1.1` 版本号。

## Hermes 与 DeepSeek Harness 的适用性结论

截至 2026-11-13，建议短期继续使用 Hermes，先收紧运行时交付边界；DSH 作为候选引擎做独立验证，不立即替换生产。我们已有的工程计划、物料/MCP 契约、候选暂存、验收和逐页提交应由 Alex 管理；无需重写通用模型/工具执行循环。也不能让某个引擎的会话摘要代替工程和原始需求。

已知故障分层：

| 现象 | 已确认责任边界 | 换引擎的作用 |
| --- | --- | --- |
| 每分钟 100 万 Token 限额 | 服务端配额；大型项目历史输入扩大请求量 | 不能提升配额，仍需预算、等待和上下文设计 |
| Responses 流内错误退化为未知 Internal error | Hermes 原生路径与 Alex 重试适配边界；此前真实协议测试漏了 Responses | 可能改变错误传播方式，不能未经测试宣称消失 |
| 重启后误报工程已变化 | Alex 把内存冲突版本复用于持久恢复 | 不会自动解决 |
| 明细关联能力或验收绑定不足 | Alex 物料、动作、需求和验收契约 | 不会自动补齐产品能力 |
| 新用户安装组合与已验证运行时不一致 | Alex 安装跟随 stable，而恢复适配依赖确切源码摘要 | Hermes 或 DSH 都需要锁定并验证发布组合 |

[Hermes 官方集成文档](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration) 提供 ACP、Gateway JSON-RPC、HTTP/SSE 三种入口，并将需要细粒度会话/事件控制的自定义宿主列为 Gateway 的适用场景。可以研究用官方能力替换部分私有 SessionDB、源码补丁和桥接依赖；须先核对锁定版本的工具作用域、压缩事件、取消、权限和恢复能力，不把换传输协议当成重试问题已经解决。

[DSH 架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) 将模型适配、工具、日志及执行循环设计为可替换插件，提供 SDK/profile。由此推断它值得用于评估嵌入和定制成本；这不是生产稳定性验证。[官方 README](https://github.com/deepseek-ai/deepseek-harness) 仍明确标注开发预览与破坏兼容的变化风险。其 ACP 和 SDK 能力应分别验证，不假定现有 Hermes ACP/MCP 接入可无缝替换。任何引擎都不能承诺无幻觉、未知写入可安全重放或压缩数学意义上无损。

后续优先级：

1. 固定桌面版本对应的运行时源码、依赖、配置和适配版本；安装、升级、回滚使用同一份经过验证的组合。未知摘要拒绝加载是正确性保护，不能替代发布可用性管理。必要补丁应维护成可构建、可回滚的受控发行，逐步减少运行时文本替换和私有 API 依赖。
2. 保留原始需求、确认计划、标识/关联、当前候选及待验收项为权威持久数据；后续单独设计按页工作上下文和历史检索，降低重复输入。不能突然清空历史或仅留一段摘要。
3. 用同一批真实项目、模型与服务额度比较 Hermes/DSH，加入限流、部分输出、压缩、取消、重启、升级及多项目隔离故障注入。衡量可用页面完成率、耗时、Token、重复写入、恢复成功率和维护成本。单元测试通过不是生产生成成功率。
4. 引擎适配接口负责会话、流事件、工具执行和取消；Alex 继续负责账号/项目边界、事务提交与业务验收。当前生成在用户桌面本地执行，104 的账号/发布/诊断服务并非集中模型执行服务；扩用户首先增加运行时兼容与支持成本。共享模型密钥需统一预算/并发治理；若改成云执行，再专项设计租户、凭证、工作区与任务隔离。

本轮没有实施引擎迁移或改写长上下文策略。选择 Hermes 可以持续迭代，但继续扩大用户前，运行时版本治理与跨协议、跨平台的发布验证必须成为正式工程边界。

## 阶段 1 实施规格：错误分类、单次请求重试条件与候选状态表（2026-11-14）

### 1. 三项正交判定原则

阶段 1 将单次模型调用异常拆分为三个彼此独立的判定，禁止仅凭 HTTP 状态码合并推断：

1. **错误类别（`failure.reason` + `providerCode` + `providerEvidence`）**：仅使用服务端已部署诊断白名单枚举（`rate-limit`、`quota`、`context-limit`、`authentication`、`timeout`、`network`、`validation`、`stale-state`、`context`、`storage`、`unclassified`），配合结构化 `providerCode` 与 `providerEvidence`（`http-error` | `responses-error-event`），不上传原始错误正文或密钥。
2. **单次请求恢复动作（`retry` | `delegate-native-overflow` | `stop`）**：
   - 全链路共享唯一重试预算：`MAX_ATTEMPTS = 6`、`WAIT_BUDGET = 180.0s`（单调时钟），强制 `client.max_retries == 0`，接管并关闭 `_StreamingCall` 内部流重试与 5xx 非流探针，固定 `codex_runtime` `max_stream_retries = 0`。
   - **纯模型推理能力边界（`pure_inference_request(request, agent=..., error=...)`）**：必须基于**最终有效请求体**采用失败封闭（fail-closed）判定——合并核验顶层字段、`agent.request_overrides`、`request.request_overrides`、SDK 合并 `extra_body`（含 `bypass_sdk_request_transform`）、协议转换后的客户端工具声明格式（Chat `function`、Responses `function`、Anthropic `input_schema`、Bedrock `toolSpec`）以及异常附带的实际序列化 HTTP 请求体；任何层或最终请求体出现服务端有状态工具/能力（`web_search`、`mcp`、`code_interpreter`、`file_search`、`mcp_servers`、`web_search_options`、`plugins`、`store=True` 等）或无法识别的请求形态一律判为 `False`。根据 RFC 9110 §15.6.3 / §15.6.5，HTTP 502 / 504 **不能证明上游未处理请求**；之所以允许在预算内有限重试，依据是 `pure_inference_request == True`（上游仅做无外部副作用的模型推理）、零输出已消费（`zero_output_consumed == True`）且本地前序工具结果已落定。
   - **HTTP 429 与 HTTP-200 Responses 错误帧分开泛化**：HTTP 429 本身提供协议级限流证据（排除明确账单/硬配额墙与单请求超 TPM 容量后允许等待重试）；HTTP 200 的 Responses SSE `error` / `response.failed` 帧无同等协议证据，**仅明确限流码（`rate_limit_exceeded`、`rate_limit_error`、`throttled`、`resource_exhausted` 或 `type in ('tokens', 'requests', 'rate_limit_error')`）允许进入限流重试**，未知错误码一律不盲目重试。
   - **上下文超限原样移交与通道状态清理**：Responses 流内无输出 `context_length_exceeded` / `max_tokens_exceeded` 保留真实 `ResponsesRejected` 结构化体（`status_code = None`，`providerEvidence = 'responses-error-event'`，不伪造 HTTP 400），连同 HTTP 400/413 上下文超限一起在恢复通道记录 `status: 'delegated', reason: 'native-overflow-recovery'` 并交还原生 `recover_from_overflow` 压缩。同一 `runId` 内后续 API 调用一旦成功，必须将残留的非终态/已委托 `.status` 覆写为 `status: 'recovered'`，防止宿主终态检查误拒已恢复轮次；若原生压缩仍失败，宿主从 `delegated` 提取精确 `context-limit` 诊断。
3. **本轮终止后的本地候选草稿状态（`available` vs `uncertain`）**：
   - 独立于 HTTP 状态码判定。只要满足任一不确定条件，必须标记 `uncertain`（保留草稿但禁止自动增量续跑，须经用户执行“保留旧草稿，重新生成”归档）：
     - `hadUnfinishedNativeTools === true`：存在已启动但未收到 `completed` / `failed` / `cancelled` 终态的原生工具调用；
     - `acpTurnOutcomeUnknown === true` 或 `gatewayTurnUncertainty !== null`：`session/prompt` 发出后 ACP 子进程断开/取消超时重置，**或 ACP 进程存活但 Gateway 重启、断开、丢失任务返回 `unknown_execution` / `session_replay_gap` / `Gateway disconnected; turn outcome is unknown`，或 ACP `-32603` 缺少明确整轮终态证据（非 `admitted_turn_failed` / `not_sent`）**。恢复通道 `.status`（`waiting` / `retrying` / `recovered` / `delegated` / `stopped`）仅反映单次模型请求进展、只用于错误诊断，**绝不因其存在解除 `uncertain`**；且若终止时 `.status` 仍停留在 `waiting` / `retrying` 在途状态，一律标记 `uncertain`；
     - `retryStatus.candidateUncertain === true`：本次失败请求已产生部分文本/推理/工具流增量（`partial-response` / `PARTIAL_STREAM_STUB_ID`）、`response.failed` 含非空 `output`、连接无响应体中断 / HTTP 408 / 无终态 EOF（`request-outcome-unknown`），或含服务端有状态工具（含 `extra_body` 注入）时发生 5xx。
   - 仅当以上不确定条件均不成立（所有前序工具步骤均已确定完成、本次失败的模型请求零输出且无在途 `.status` 或工具副作用、Gateway 返回明确整轮终态 `PromptResponse` 或 `admitted_turn_failed` / `not_sent`）时，候选才标记为 `available`。

### 2. 阶段 1 完整状态迁移表

| 协议与触发场景 | 错误类别 (`failure.reason`) | 单次请求重试条件与动作 | 是否透传原生恢复 | 恢复通道 `.status` 迁移 | 终止后候选草稿状态 (`available` / `uncertain`) |
| --- | --- | --- | --- | --- | --- |
| HTTP 429（结构化限流码、纯文本或代理通用 429，无输出） | `rate-limit` | **允许重试**（`<=6` 次 / `<=180s`，遵守 `Retry-After` / reset / 正文提示下限） | 否 | `waiting` → `retrying` → 成功 `recovered`；超预算 `stopped(rate-limit-budget)` | 无未决原生工具且 ACP 终态确认 → `available`；否则 `uncertain` |
| HTTP 429 / 402 或 Responses SSE 错误帧命中账单/配额墙（`insufficient_quota`、硬限额、无短期重置的日/周配额） | `quota` | **禁止重试**（第 1 次即停） | 否 | `stopped(non-transient-limit)` | 无未决工具、零输出且 ACP 终态确认 → `available`；否则 `uncertain` |
| HTTP 429 或 Responses SSE 限流帧，单次 `tokensRequested > tokenLimit` | `rate-limit` | **禁止纯等待重试**（第 1 次即停） | 否 | `stopped(request-exceeds-token-limit)` | 无未决工具、零输出且 ACP 终态确认 → `available`；否则 `uncertain` |
| Responses HTTP-200 SSE `error` / `response.failed(output=[])` 显式限流码（`rate_limit_exceeded` 等，零输出） | `rate-limit` | **允许重试**（`<=6` 次 / `<=180s`） | 否 | `waiting` → `retrying` → 成功 `recovered`；超预算 `stopped(rate-limit-budget)` | 无未决工具且 ACP 终态确认 → `available`；否则 `uncertain` |
| Responses HTTP-200 SSE `error` / `response.failed(output=[])` 为 `context_length_exceeded` / `max_tokens_exceeded`（零输出，保留无状态码真实事件体）或 HTTP 400/413 上下文超限 | `context-limit` | **禁止原样盲目重发** | **是**：交还原生 `recover_from_overflow` 压缩后进入下一轮调用 | 移交时 `delegated(native-overflow-recovery)`；压缩后下一次调用成功立即清理为 `recovered` | 若原生压缩耗尽仍失败：无未决工具且 ACP 终态确认 → `available`；否则 `uncertain` |
| Responses HTTP-200 SSE `error` / `response.failed(output=[])` 为未知错误码、参数错误或鉴权/策略拒绝（零输出） | `authentication` / `unclassified` | **禁止重试**（第 1 次即停，不泛化为限流） | 否 | `stopped(provider-rejected)` | 无未决工具、零输出且 ACP 终态确认 → `available`；否则 `uncertain` |
| HTTP `500 / 503 / 529` 或 Responses SSE `server_error` / `overloaded`（零输出，非参数校验/非超限伪装） | `unclassified` | 仅当 `pure_inference_request` 且零输出时**允许有限重试**（`<=6` 次 / `<=180s`）；含服务端工具则第 1 次即停 | 否 | 纯推理：`waiting` → `retrying` → `recovered` 或 `stopped(server-error-budget)`；含服务端工具：`stopped(request-outcome-unknown)` | 纯推理且无未决工具、ACP 终态确认 → `available`；含服务端工具或有未决工具 → `uncertain` |
| HTTP `502 / 504`（零输出；依 RFC 9110 上游是否处理未知） | `502`: `network`；`504`: `timeout` | **不视为“未执行”**；仅当 `pure_inference_request`（上游无外部工具副作用）且零输出时**允许有限重试**（`<=6` 次 / `<=180s`）；含服务端工具则第 1 次即停 | 否 | 纯推理：`waiting` → `retrying` → `recovered` 或 `stopped(server-error-budget)`；含服务端工具：`stopped(request-outcome-unknown)` | 独立判定：纯推理且本地前序工具已落定、零输出、ACP 终态确认 → `available`；否则 `uncertain` |
| HTTP `408`、`response is None` 传输异常、`EmptyStreamError`、无终态 SSE EOF、`response.failed(output!=[])` | `timeout` / `network` / `unclassified` | **禁止重试**（第 1 次即停） | 否 | `stopped(request-outcome-unknown, candidateUncertain=true)` | **`uncertain`** |
| 已产生部分文本/推理/工具增量后中断（含 `PARTIAL_STREAM_STUB_ID`）、原生工具未决（`hadUnfinishedNativeTools`）、ACP 连接中断（`acpDisconnected`），或 ACP 存活但 Gateway 终态未知（`unknown_execution` / `session_replay_gap` / `gateway_disconnected` / 无原生终态证据的 `-32603`） | 按底层异常分类（Gateway 未知终态记 `network` + `gateway-turn`） | **禁止重试**（阻断原生续写桩与未知任务重放） | 否 | `stopped(partial-response, candidateUncertain=true)` 或无状态文件（连接/网关未知终态） | **`uncertain`** |

### 3. 升级门禁规格：固定提交、暂存验证同一份产物、空闲切换

1. **区分应用管理环境与用户自维护环境**：
   - 应用管理环境仅限 `<dataDir>/hermes-home` 下的受管目录；用户自维护的外部 Hermes（如 `~/.hermes`）严禁由应用执行 `update --yes` 或覆盖源码。外部环境点击升级时直接拒绝原地改写并保持现有连接不变。
2. **不可变目标与暂存目录准备**：
   - 绑定与 `SUPPORTED` 源码哈希清单严格对应的不可变提交 `3b421578588243f920886e6fe79a6faa87ea026e`（`v0.23.1`）。
   - 新装（`HermesManagement.install`）显式传入 `--commit` / `-Commit`；应用管理环境的升级（`HermesRuntime.update`）在不关闭当前连接、不改动原 `installDir` 的前提下，将目标版本准备到内容寻址槽位 `<hermes-home>/releases/<commit>/hermes-agent`（避免激活后重命名目录破坏 `pm/environments.py` 的路径哈希 `install_key`）。
   - **重复升级只读校验与独立修复槽位**：`prepareStagedRelease` 硬性拒绝 `resolvedSlotDir === activeInstallDir` 的就地改写；当当前活动运行环境已处于目标提交或目标槽位时，重复升级直接执行只读 `verifyStagedRelease`（带 `HERMES_DISABLE_LAZY_INSTALLS=1`，不重新生成启动器、不执行 `pm install`），校验通过且已连接时保持原连接不变；若目标槽位作为当前目录发生提交偏离需修复，则分配独立槽位 `releases/<commit>-<id>/hermes-agent`，确保校验失败时原环境零改动。
3. **激活前同产物四重校验**：
   - 核对槽位 Git `HEAD` 精确等于目标提交；
   - 对该槽位执行 `prepareNativeRecovery`（校验全部 `SUPPORTED` 文件 SHA-256 并生成受检恢复副本）；
   - 校验启动器 `--print-runtime-command` 及 `acp` / `web` 依赖可用；
   - 在隔离验证目录（共享只读 `tools` / `installs`）中实际运行 `hermes-recovery-gateway.py` 与 ACP `initialize` 握手，确认恢复策略与通道指纹一致后清理隔离 Gateway。
4. **空闲切换与配置/连接一致性回滚**：
   - 暂存或任一校验失败时，原运行连接、`runtime.json` 与原安装目录零改动、立即可继续使用；
   - 切换前再次确认所有会话空闲；若激活切换失败，**无论升级前是否处于已连接状态，均无条件恢复原持久配置（`runtime.json` 与 `settings`）并清理失败槽位**；若升级前已连接则尝试恢复原连接，原连接恢复失败时显式抛出双侧失败原因而不吞没异常；前端依据 `detect()` 返回的真实连接状态更新界面（未连接绝不恢复为 `running`）。
5. **范围边界**：`hermes-context.py` 的 Gateway 连接复用属于独立性能优化，不纳入阶段 1 故障恢复提交。

## 阶段 2 实施规格：按页子会话隔离、v3 依赖足迹重放与源头事件鉴权（2026-11-14）

### 1. 按页独立子会话与五元事件/结果强绑定

- **规划会话与页面执行子会话拆分**：`conversation` 规划阶段继续使用 `<convDir>` 主会话（`planningSessionId`）；`generating` 阶段按 `targetPageId` 使用 `resolveExecutionPaths(convDir, 'generating', targetPageId)` 映射到 `<convDir>/page-runs/<sha256(targetPageId).slice(0, 16)>` 独立子会话（`execSessionId`），避免长批次上下文线性膨胀与单页压缩影响其他页面。
- **五元身份与每轮 `clientRequestId` 配对**：主进程事件与 `HermesReply` 携带 `{ planningSessionId, execSessionId, sessionId, taskKey, runId, targetPageId, clientRequestId }`。前端 `useHermesStore`、`useAiPreviewStore` 与 `projectWorkflow.ts::runModel()` 按每次 `execute()` 独立生成 `clientRequestId` 并锁定首个匹配 `run-start` 的 `{ runId, execSessionId }`，严格拒绝迟到或未登记轮次的流式帧、预览与返回值。

### 2. Gateway / ACP 源头事件归属、非阻塞门禁与空闲权限分流

- **源头 `admission_id -> alex_run_id` 绑定**：`HermesRuntime` 在 `session/prompt` 下发 `_meta.alex_run_id`；私有恢复副本在 `GatewayACPAgent`（及本地 `HermesACPAgent`）按 `receipt.admission_id` 维护有界 LRU `_admission_runs`（回合结束不删条目，迟到旧 `admission_id` 始终解析回旧 `runId`），所有回合出站通知及权限/澄清请求均携带源头 `_meta: { admission_id, alex_run_id }`。
- **连接代次绑定的 `SubmitAckGate` 与单执行者 `SessionDrainer`**：在 `prompt.submit` 返回前先确保连接并绑定连接代次 `link_gen` 创建 `SubmitAckGate`（覆盖 `acked`、`failed`、`cancelled`、`teardown` 四路出口；旧连接 `finally` 校验代次与对象身份，不误删重连后的新 gate）。共享 `_events()` 泵永不 `await gate`；只要会话存在未决 gate 或活动 `SessionDrainer`，同会话后续帧（含 `message.complete` 与恢复元组）一律入队由唯一活动排空器按严格 FIFO 投影，直到最后一帧 `await` 完成后同步注销，杜绝乱序超车与跨会话队头阻塞。
- **`replay_gap` 控制恢复与三通道权限鉴权**：`PendingControls` 记录每个 `admission_id` 的来源（`live_turn` vs `adopted_snapshot`），`replay_gap` 快照重建审批/澄清卡片时仅对本连接已登记的 `live_turn` 恢复真实 `alex_run_id`，拒绝绑定连接前遗留会话控制。`HermesRuntime.onRequest` 显式区分 `turn`（要求 `s.running && meta.alex_run_id === s.runId`）、`model_switch`（核对空闲会话 `activeModelOp.opId === meta.alex_model_op_id`）与 `slash_model_switch` 三类控制通道。

### 3. `v3` `DependencyFootprint` 全事实追踪、候选重放与零 `await` 同步提交

- **工具级真实读取事实与查询集合证明**：`generating` 阶段显式收窄 `protoflow_get_project` 等宽查询的默认返回范围；`protoflow-mcp.cjs` 按工具实际返回内容记录 `ReadSet`（覆盖 `planCoreHash`、目标页与激活 `revision.merge.sourcePageId` 状态、全表目录哈希 `tableCatalogHash` / `allDbTablesHash`、跨页跳转扫描 `allPageSourcesHash`、页面便签/问题及精确读取的单条需求原文）与 `WriteSet` 前像，同时记录笔记/表/目录过滤查询的命中 ID 集与完整参数证明。
- **基于最新工程重放候选与同步提交复验**：恢复加载（`execute({ recoverDraft: true })`）先通过纯只读资格门禁（校验 `status === 'available'`、账号/环境/模型/契约一致及 `verifyDependencyFootprint(latestSnapshot, footprint)`），再在 `structuredClone(latestSnapshot)` 上通过 `replayCandidateOperations` 重放候选操作，保留其他独立页已落盘成果。最终 `applyProjectChanges` 在零 `await` 同步临界区内复验 `ReadSet`、`WriteSet` 前像及笔记查询集合后一次性提交内存状态；落盘成功后 `completeRecovery` 仅按身份幂等标记 `committed`，不再二次校验写前前像。

### 4. 三态 ACP 历史边界与零孤儿五步预写迁移日志

- **三态会话表面判定与工具封禁**：`hermes-acp-surface.py` 统一实现 `classify_session_surface(own_db, sid) -> "acp" | "non_acp" | "unknown"`（兼容 `source="acp"`、`source="local" + created_source="acp"` 及压缩链 `local_receipt`）。私有恢复副本在 `toolsets.py` / `gateway/run_turn.py` 剥离 ACP 平台的原生 `session_search` 工具定义，并在 `session_search_tool.py` 最顶部（解析 `@session:` 与切换跨 `profile` DB 之前）拦截 `"acp"` 与 `"unknown"` 调用；`protoflow_search_history` 仅对白名单谱系（当前 `execSessionId`、历史迁移 `lineage`、`planningSessionId` 及其压缩链）中满足 `"acp"` 且 `realpath(cwd) == realpath(expectedCwd)` 的会话放行。
- **幂等创建凭据与五步 `pendingMigration` WAL**：当会话需轮转迁移时，Step 1 先将 `{ opId, createBinding, fromSessionId, ... }` `fsync` 写入检查点 `pendingMigration`；Step 2 通过 `_meta.alex_request_id = opId` 调用 `session/new`，利用 Gateway `commit_local_session` 幂等键闭合“建会话成功但未写回 `toSessionId`”的崩溃窗口（零孤儿会话）；Step 3 同步模型与推理档位；Step 4 原子切换 `<execDir>/session.json` 并追加 `lineage`；Step 5 归档 `sessionMigrations[]`（同步保留页面澄清摘要 `clarifications[]` 供跨会话续跑提示注入）。

### 5. 结构化 IPC 失败信封与批次保守推进边界

- **结构化脱敏信封**：`HermesRuntime`、`preload.cjs` 与 `hermesClient.ts` 传递经同源脱敏规则清洗的 `HermesFailureEnvelope`（`code`、`failureScope`、`terminalConfirmed`、`candidateStatus`、`targetPageId`），不透传原始异常体、本地路径或密钥。
- **保守批次推进**：多页批量生成中，凡 `PROVIDER_REJECTED`、限流/5xx 预算耗尽、配额/鉴权错误、Gateway/ACP 未知终态及未识别错误（`shared` / `unknown`）一律立即停止当前批次；仅当模型回合正常结束且经 1 次 `continuation` 后仍触发宿主页面级静态验收失败（`PAGE_VALIDATION_FAILED` 且 `failureScope === 'page' && terminalConfirmed === true`）时，保留该页 `available` 草稿，跳过其传递闭包下游依赖页（含 `dependencies` 与 `revision.merge.sourcePageId`），继续生成完全不交集的独立页面。
