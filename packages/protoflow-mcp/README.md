# `@protoflow-ai/mcp`

Zero-dependency **Model Context Protocol (MCP)** server for **[Alex (ProtoFlow AI)](https://github.com/EvanClub-Agent/protoflow-ai)**.

Connect AI Coding & Design Agents (**Codex**, **Google Antigravity**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**) to an Alex business prototype — either in **read-only specification mode** (default, for generating production code) or **read-write authoring mode** (to create/edit `.pflow` prototypes, pages, ER schemas, seed rows, notes, and Mermaid flows).

## Modes

* **Read-Only Spec Mode (`--mode readonly`, default)**: Exposes 6 read-only specification tools, 2 dev prompts, and 3 direct spec/DDL resources against a local `.pflow` file or a remote published share URL (`/p/<shareId>`).
* **Read-Write Authoring Mode (`--mode readwrite`)**: Exposes all 6 spec tools + 11 contract-enforced authoring tools, 4 authoring prompts (`design-full-project`, `design-page`, `refine-page`, `design-database`), and `protoflow://authoring/playbook` against a local `.pflow` project or `--workspace <dir>`.

> Companion Agent Skill: install [skills/alex-protoflow-designer](../../skills/alex-protoflow-designer/SKILL.md) into your client's skills directory (or rely on the built-in MCP Prompts in Claude Desktop).

## Quick Start

### Option 1: Remote HTTP MCP (Read-Only Spec Mode, Zero Local Install)
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

### Live editing in Alex Desktop

Open a saved project, then choose **MCP → Local → Bidirectional design**. Copy the generated configuration into your agent client. It runs the bundled stdio CLI with `--mode readwrite --desktop-bridge <connection.json>`. Keep Alex open. The connection file is specific to this project and contains a local credential. Only copy the generated configuration.

Start with `protoflow_workspace` using `action: "status"` to read the live revision, active page and selected component. Inspect the page before editing and include `expectedRevision` on writes. Edits appear on the canvas, use the desktop autosave queue, and can be undone from the top bar or with Cmd/Ctrl+Z. Hermes tasks block external writes until they finish. After a save error, the edit remains visible in Alex and saving can be retried there.

Returning to the launcher, closing Alex, or selecting **Read-only specs** revokes the connection. Enable it again on the same project to reuse its configuration. Create and switch projects in the desktop launcher. The local file workflow below also supports project creation and switching.

Use the install buttons to add the bundled designer skill to Codex, Antigravity or Claude Code. Each button uses the client's personal skill directory. Claude Desktop can use the MCP prompts directly. [Codex skills](https://developers.openai.com/codex/skills/) · [Antigravity skills](https://antigravity.google/docs/skills) · [Claude Code skills](https://code.claude.com/docs/en/skills)

### Option 2: Authoring Mode (`--mode readwrite`) for Codex / Antigravity / Claude Desktop

#### Antigravity / Claude Desktop / Cursor (`mcp_config.json` / `claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "protoflow": {
      "command": "node",
      "args": [
        "/absolute/path/to/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs",
        "--mode", "readwrite",
        "--workspace", "/absolute/path/to/AlexProjects"
      ]
    }
  }
}
```
*(You can also pass `--project /absolute/path/to/project.pflow` instead of or together with `--workspace`, or use the Alex Desktop bundled runtime via `ELECTRON_RUN_AS_NODE=1`.)*

#### Codex (`~/.codex/config.toml`)
```toml
[mcp_servers.protoflow]
command = "node"
args = [
  "/absolute/path/to/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs",
  "--mode", "readwrite",
  "--workspace", "/absolute/path/to/AlexProjects"
]
```

#### Claude Code (CLI)
```bash
claude mcp add protoflow -- node /absolute/path/to/protoflow-ai/packages/protoflow-mcp/dist/cli.cjs --mode readwrite --workspace /absolute/path/to/AlexProjects
```

### Option 3: Read-Only Local `.pflow` or Online Share over Stdio
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

## Available Tools

### Read-Only Spec Tools (Always Available)

| Tool | Description |
| :--- | :--- |
| `protoflow_get_project_overview` | Navigation sitemap, page catalog, shared table summary, business agreements, and static health checks |
| `protoflow_get_database_schema` | ER physical tables, primary/foreign keys, unique constraints, PostgreSQL/MySQL DDL drafts, and seed rows |
| `protoflow_get_page_spec` | Single-page TSX layout, table bindings, interactive actions (`submitForm`, `updateRow`, `navigate`), pinned sticky notes, and optional `inspectPage` diagnostics |
| `protoflow_get_docs_and_flows` | Product requirement notes (Markdown) and Mermaid business diagrams (`.mmd`) |
| `protoflow_search_spec` | Full-text search across tables, columns, pages, sticky notes, agreements, and diagrams |
| `protoflow_get_implementation_checklist` | Actionable full-stack implementation checklist inferred from tables, actions, and sticky notes |

### Authoring Tools (Enabled with `--mode readwrite`)

| Tool | Description |
| :--- | :--- |
| `protoflow_workspace` | Check active workspace status, list `.pflow` files, create new projects, switch active `.pflow`, or update project metadata |
| `protoflow_get_implementation_guide` | Progressive scenario recipes (`list`, `form`, `detail`, `picker`, `dashboard`, `workflow`, `layout`, `mobile`, `axure`, `custom`) |
| `protoflow_get_contracts` | Live registered component props, `valueSchema`, events, child rules, snippets, and action contracts |
| `protoflow_manage_sitemap` | Upsert folders, move folders/pages, rename custom pages, or cascade-delete menu items |
| `protoflow_upsert_db_tables` | Batch-create/update ER tables with modeling metadata, PK/FK/unique constraints, upsert columns, or delete tables |
| `protoflow_manage_table_rows` | Read, seed, replace, or clear coherent preview rows in `tableRows` |
| `protoflow_write_page` | Create or overwrite a full desktop (`<Page>`) or mobile (`<MobilePage>`) page after strict contract & platform validation |
| `protoflow_edit_page_block` | Losslessly append children, replace a node preserving `pfId`, or delete a node on an existing page |
| `protoflow_manage_sticky_notes` | Attach, update, or delete component-pinned requirement sticky notes |
| `protoflow_manage_docs_and_flows` | Create/update/delete PRD notes (Markdown), Mermaid mindmaps/flowcharts, and durable project agreements |
| `protoflow_audit_project` | Full closed-loop static audit across references, ER design, preview FK integrity, and page contracts |

## License

Apache-2.0
