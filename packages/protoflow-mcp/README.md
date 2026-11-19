# `@protoflow-ai/mcp`

Zero-dependency, read-only **Model Context Protocol (MCP)** server for **[Alex (ProtoFlow AI)](https://github.com/EvanClub-Agent/protoflow-ai)**.

Connect Coding Agents (**Claude Code**, **Cursor**, **Google Antigravity**, **Windsurf**, **Codex**) directly to an interactive Alex business prototype — either a local `.pflow` file or a remote published share URL (`/p/<shareId>`).

## Quick Start

### Option 1: Remote HTTP MCP (Zero Local Install!)
If your team hosts a ProtoFlow publishing server, Coding Agents can connect directly over Streamable HTTP without installing Node.js or Alex Desktop:

```json
{
  "mcpServers": {
    "protoflow": {
      "url": "https://proto.example.com/api/v1/mcp/<shareId>"
    }
  }
}
```

*(For password-protected shares, add `"headers": { "X-Protoflow-Password": "<password>" }`, or `"X-Protoflow-Password-Base64": "<utf8-base64>"` when the password contains leading/trailing spaces or non-ASCII characters.)*

### Option 2: Alex Desktop Built-In Runtime (Zero Node.js Required)
Click **"MCP 接入"** in the Alex Desktop top toolbar to copy the exact machine-local configuration powered by Alex's bundled runtime (`ELECTRON_RUN_AS_NODE=1`).

### Option 3: Run Standalone CLI Bundle from Source
After running `npm run build:contracts` (included automatically in `npm run dev` and `npm run build`):

```json
{
  "mcpServers": {
    "protoflow": {
      "command": "node",
      "args": ["/absolute/path/to/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs", "--project", "/absolute/path/to/project.pflow"]
    }
  }
}
```

Or connect to an online share over `stdio`:

```json
{
  "mcpServers": {
    "protoflow": {
      "command": "node",
      "args": ["/absolute/path/to/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs", "--share", "https://proto.example.com/p/<shareId>"]
    }
  }
}
```

## Available Read-Only Tools

| Tool | Description |
| :--- | :--- |
| `protoflow_get_project_overview` | Navigation sitemap, page catalog, shared table summary, business agreements, and static health checks |
| `protoflow_get_database_schema` | ER physical tables, primary/foreign keys, unique constraints, PostgreSQL/MySQL DDL drafts, and seed rows |
| `protoflow_get_page_spec` | Single-page TSX layout, table bindings, interactive actions (`submitForm`, `updateRow`, `navigate`), and pinned sticky notes |
| `protoflow_get_docs_and_flows` | Product requirement notes (Markdown) and Mermaid business diagrams (`.mmd`) |
| `protoflow_search_spec` | Full-text search across tables, columns, pages, sticky notes, agreements, and diagrams |
| `protoflow_get_implementation_checklist` | Actionable full-stack implementation checklist inferred from tables, actions, and sticky notes |

## License

Apache-2.0
