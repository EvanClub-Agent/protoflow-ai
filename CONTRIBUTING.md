# 参与贡献指南 (Contributing to Alex)

感谢你对 **Alex (ProtoFlow AI)** 的关注！为了让每一位社区伙伴都能轻松上手，我们把前端画布、组件物料与后端服务做了彻底解耦——**绝大多数功能开发都不需要安装 Go、PostgreSQL 或配置 AI 密钥**。

---

## 1. 60 秒本地跑起来

前置要求：**Node.js 22+**（可使用 `nvm use` 自动读取 `.nvmrc`）。

```bash
git clone https://github.com/EvanClub-Agent/protoflow-ai.git
cd protoflow-ai
npm install
npm run dev
```

打开终端提示的 `http://localhost:5173` 即可直接免登录进入工作台！  
如果你修改了 `electron/` 目录下的桌面主进程逻辑，可运行 `npm run electron:start` 验证桌面端行为。

---

## 2. 最适合首次提 PR 的 3 个方向（First PR 指南）

### 方向 A：新增或增强原型组件物料（15~30 分钟）
Alex 的组件物料由元数据契约驱动，一旦注册，画布拖拽、右侧属性面板与 AI 生成契约会自动生效：
- **PC 中后台物料**：
  - 组件元数据与属性定义：`src/proto/registry/meta.ts` / `src/proto/registry/antdMeta.ts`
  - 画布渲染实现：`src/proto/registry/components.tsx` / `src/proto/registry/antdComponents.tsx`
  - 物料契约校验：`src/proto/registry/materialSchemas.ts`
- **移动端物料**：
  - 元数据定义：`src/proto/mobile/meta.ts`
  - 渲染实现：`src/proto/mobile/components.tsx`
- **本地验证命令**：
  ```bash
  npm run build:contracts
  npm test
  ```

### 方向 B：贡献行业起点模板或 Mermaid 图表模板
产品经理与前端开发者都可以轻松贡献高质量样板工程：
- **新建项目起点模板**：参考 `src/proto/starter/crmStarter.ts` 或 `src/proto/mobile/starter.ts`，定义物理表、演示数据行与 DSL 页面源码，并在 `src/services/projectStorage.ts` 和 `src/components/ProjectWelcomeLauncher.tsx` 注册卡片即可。
- **Mermaid 流程图/架构图模板**：在 `src/services/mermaidCatalog.ts` 中新增通用业务图谱示例，运行 `npm run test:mermaid-diagrams` 验证。

### 方向 C：扩展 AI 模型目录、导出能力或自托管体验
- **模型厂商目录与图标**：`src/services/hermesModelCatalog.ts` 与 `src/assets/model-providers/`
- **离线 HTML 导出与在线浏览端**：`src/services/webExport.ts` 与 `src/viewer/`
- **Go 发布服务（可选）**：位于 `server/`，需要 Go 1.27+，修改后运行 `npm run server:test`。

---

## 3. 提交 PR 前的自检清单

在发起 Pull Request 前，建议在本地运行以下命令确认构建与回归测试全部通过：

```bash
# 1. 重新生成物料契约并跑回归测试
npm test

# 2. 验证桌面端与在线浏览端 TypeScript + Vite 构建通过
npm run build
npm run build:viewer

# 3. （仅当修改了 server/ 时）运行 Go 测试
npm run server:test
```

### 提交规范建议
- 保持单次 PR 聚焦于一个明确主题（新物料、模板、Bug 修复或文档改进），方便快速 Review 合入。
- **切勿提交**个人机器绝对路径、真实服务器 IP、`.env` / `*.local` 配置文件或任何密钥凭证。
- 带有 UI 变更的 PR 欢迎附上一张动图或截图，我们会优先在 48 小时内响应并致谢每一位贡献者！
