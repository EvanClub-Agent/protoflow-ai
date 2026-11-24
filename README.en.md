<div align="center">

<img src="./public/logo.svg" width="92" height="92" alt="ProtoFlow AI Logo" />

# ProtoFlow AI

### Open-Source AI Prototyping Workbench — Turn Requirements into Runnable Apps

Describe your business workflow — ProtoFlow AI clarifies edge cases first, plans your sitemap, pages, and shared relational ER tables,<br/>
lets you refine **Desktop Admin** & **Mobile Viewports** on a bidirectional AST canvas, imports Axure `.rp` binaries offline, and connects coding agents via MCP.

**[Try Live Browser Demo](https://alex.xclubai.com/demo/)** · **[Official Website](https://alex.xclubai.com/en/)** · **[MCP Docs](https://alex.xclubai.com/mcp/)** · **[Join Discord](https://discord.gg/YDnKBhmsrR)** (share prototypes in `#general` or ask in `#help-and-bugs`).

[![Website](https://img.shields.io/badge/Website-alex.xclubai.com-1D4ED8?style=flat-square)](https://alex.xclubai.com/en/)
[![License](https://img.shields.io/badge/License-Apache_2.0-2563EB?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/EvanClub-Agent/protoflow-ai/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/EvanClub-Agent/protoflow-ai/actions)
[![Platform](https://img.shields.io/badge/Desktop-macOS_%7C_Windows_%7C_Linux-141413?style=flat-square)](https://github.com/EvanClub-Agent/protoflow-ai/releases)
[![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Docker_Compose-0EA5E9?style=flat-square)](./deploy/compose.yml)
[![Node](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square)](./.nvmrc)
[![Go](https://img.shields.io/badge/Go-1.27%2B-00ADD8?style=flat-square)](./server/go.mod)

[简体中文](./README.md) · **English**

[Live Browser Demo](https://alex.xclubai.com/demo/) · [Quick Start](#-quick-start-in-60-seconds) · [Why ProtoFlow AI](#-why-protoflow-ai) · [Key Features](#-key-features) · [Self-Host with Docker](#-self-hosted-deployment-docker-compose) · [Contributing](#-contributing)

<br/>

<img src="./docs/assets/workbench-screenshot.png" width="100%" alt="ProtoFlow AI Desktop Workbench Screenshot showing the CRM Contracts & Billing suite" />

</div>

---

## 💡 Why ProtoFlow AI?

Product managers and engineering teams are often stuck between **static wireframing tools** (where forms don't submit and tables don't share data) and **one-shot AI HTML generators** (that guess requirements blindly, invent isolated mock data per page, and break layouts on follow-up edits).

**ProtoFlow AI (formerly Alex)** bridges requirement engineering, relational data modeling, and interactive prototyping in one local-first desktop workbench:

- **Shared Physical Tables (ER) Across Pages**: Forms, tables, drawers, and ECharts bind to real project schemas — records created on an order form immediately flow into approval queues and mobile views.
- **Clarify First, Generate Second**: Powered by **NousResearch Hermes Agent**, Project AI asks clarifying questions on ambiguous business rules and proposes a structured blueprint before generating pages.
- **Bidirectional AST Canvas**: Drag-and-drop enterprise desktop & mobile materials or edit properties visually — synced losslessly with clean TSX DSL.
- **Desktop + Mobile in One Project**: Author wide-screen admin dashboards alongside iPhone mobile viewports sharing the exact same database tables.
- **100% Local-First & Offline Ready**: Works out of the box **without mandatory sign-in**. Projects stay on your disk (`.pflow` binary archive + Git-friendly unpacked tree), with optional **1-command Docker Compose** self-hosting for online `/p/{id}` team review links.

---

## ✨ Key Features

- **01 · Project-Level AI Planning**: Clarifies business constraints, proposes sitemaps + ER schemas, and supports scoped incremental edits without overwriting existing pages.
- **02 · Enterprise Desktop & Mobile Materials**: Built-in Ant Design-style query forms, master-detail tables, modals/drawers, composite blocks, mobile bottom sheets, and sandboxed freeform components.
- **03 · Navicat-Style ER Database Designer**: Visual relational schema editor, foreign-key validation, cross-module data transfer, and realistic preview datasets.
- **04 · 12 Native Apache ECharts + Mermaid Diagrams**: Bar, Line, Area, Pie, Donut, Scatter, Radar, Gauge, Funnel, Heatmap, Treemap, and Sankey charts bound directly to project tables, plus Mermaid architecture/sequence templates.
- **05 · Component Sticky Specs & Closed-Loop Audit**: Pin requirement notes directly onto UI controls, trace schema change impact across menus, and audit broken links or unbound foreign keys.
- **06 · Self-Hosted Online Sharing & Release Center**: Share password-protected, expiring, versioned `/p/{id}` interactive prototypes via a lightweight Go + PostgreSQL + Nginx stack.
- **07 · Bidirectional MCP Authoring, Visual Capture & Read-Only Spec Server**: Let **Codex**, **Google Antigravity**, **Claude Desktop**, **Claude Code**, or **Cursor** directly design and refine prototypes on the live Alex Desktop canvas (`--mode readwrite --desktop-bridge`) — modeling shared ER tables, seeding FK-valid rows, editing `<Page>` / `<MobilePage>` subtrees by `selectedPfId`, verifying rendered layouts via `protoflow_capture_preview` PNG screenshots, and supporting multi-step `Cmd/Ctrl+Z` undo, with one-click **Antigravity plugin** install and **Claude Desktop `.mcpb`** export. For engineering handoff, connect in read-only mode to any `/p/{id}` share URL over Streamable HTTP (zero local install) or local `.pflow` file. See the **[Official MCP Setup & Tools Guide](https://alex.xclubai.com/mcp/)**.
- **08 · Native Axure (`.rp`) Binary Import & Controlled AI Flow Reshaping**: Drop Axure RP 9 or RP 11 `.rp` files directly into Alex locally without Axure installed. Edit imported pages visually or let Project AI reshape scattered wireframes and static grids into flow-layout `QueryForm` + `Table` + `Descriptions` backed by shared physical ER tables, with strict per-column mapping, row-action consistency checks, and itemized **Converted / Retained / Pending** confirmation reviews alongside the preserved original RP pages.

---

## 🚀 Quick Start in 60 Seconds

Download desktop installers (new AppImages use `ProtoFlow_AI-*` and other installers retain the `Alex-*` filename) for macOS, Windows, and Linux from **[alex.xclubai.com/en/#download](https://alex.xclubai.com/en/#download)** or **[GitHub Releases](https://github.com/EvanClub-Agent/protoflow-ai/releases)**, try the **[Browser Live Demo](https://alex.xclubai.com/demo/)**, or run from source locally (no Go or PostgreSQL installation is required — just **Node.js 22+**):

```bash
git clone https://github.com/EvanClub-Agent/protoflow-ai.git
cd protoflow-ai
npm install

# Start browser live-reload workbench (instant access, no login required)
npm run dev

# Or launch the full Electron desktop app (local autosave + Hermes AI Manager)
npm run electron:start
```

Choose from built-in starter templates right from the Welcome Launcher:
- **SaaS E-Commerce & Inventory Admin** (multi-page shared tables, PO-to-inbound transfer, sticky specs)
- **CRM Sales Analytics Dashboard** (table-bound ECharts line/bar charts + customer pipeline CRUD)
- **Modern Mobile & Hybrid App Starter** (mobile waterfall feed, task approval sheet, and cross-platform table sharing)

---

## 🐳 Self-Hosted Deployment (Docker Compose)

Want to share interactive `/p/{id}` prototype links with your team in the browser? Spin up the self-hosted publishing server (`PostgreSQL 18 + Go API + Nginx Viewer`) in 3 commands:

```bash
# 1. Copy environment config and set POSTGRES_PASSWORD & PUBLIC_ORIGIN
cp deploy/.env.example deploy/.env

# 2. Pull prebuilt GHCR images and start PostgreSQL, Go API, and Web Viewer (add --build if building locally)
docker compose --env-file deploy/.env -f deploy/compose.yml up -d

# 3. Verify service health
curl -fsS http://127.0.0.1:8088/healthz
```

Then click **"Local Mode · Connect Server"** in the Alex toolbar, enter your `PUBLIC_ORIGIN` (e.g. `http://localhost:8088` or `https://protoflow.example.com`), register an account, and publish!

Optional platform admin initialization for `/releases/admin`:

```bash
docker compose --env-file deploy/.env -f deploy/compose.yml exec api /app/protoflow create-admin admin
```

---

## 🤝 Contributing

We welcome PRs of all sizes! Because the canvas, material registry, and backend are cleanly decoupled, you can add a new UI component material, starter template, or Mermaid diagram in **15–30 minutes** using only `npm run dev` and `npm test`.

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for exact file paths and verification commands.

---

## 📄 License

Licensed under the **[Apache License 2.0](./LICENSE)**.  
Provider brand icons are courtesy of LobeHub Icons ([License Notice](./website/assets/providers/LICENSE)).
