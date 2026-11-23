# `@protoflow-ai/mcp`

Zero-dependency **Model Context Protocol (MCP)** server for **[Alex (ProtoFlow AI)](https://alex.xclubai.com/en/)** ([Official MCP Guide](https://alex.xclubai.com/mcp/) · [GitHub](https://github.com/EvanClub-Agent/protoflow-ai)).

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

Open a saved project, then choose **MCP → Local → Bidirectional design**. Copy the generated configuration into your agent client. It runs the bundled stdio CLI with `--mode readwrite --desktop-bridge <live.json>`. Keep Alex open. The `live.json` file holds the active local credential and updates automatically when you create or switch projects in Alex Desktop.

Start with `protoflow_workspace` using `action: "status"` to check the project ID, live revision, active page and selected component. Every desktop write requires the intended project's current revision as `expectedRevision`. If a write reports a conflict, read the status and inspect the target again before retrying. Edits appear on the canvas, use the desktop autosave queue, and can be undone from the top bar or with Cmd/Ctrl+Z. Hermes tasks block external writes until they finish. After a save error, the edit remains visible in Alex and saving can be retried there.

The desktop-only `protoflow_capture_preview` tool accepts an optional `pageId` (active page by default), `scope` (`viewport` or `canvas`), `fullPage` (default false), and `waitMs` (0–5000). It renders an isolated preview of the saved and pending editor data, with at least 1280 CSS pixels of desktop page width. Charts finish without entry animation and freeform frames confirm their first render before capture. A material readiness timeout returns an error. Full-page capture expands the page to fit its contents, up to the 2160 CSS-pixel window height. Check `truncated` for content beyond the image. The mobile stage fits the selected device. It returns a PNG image block plus page ID, platform, pixel dimensions and revision. The editor's selection, scroll and undo history stay in place. A change during capture returns a revision conflict.

Returning to the launcher pauses the connection. Opening or creating a project resumes it in the same desktop session. Switching to **Read-only specs**, changing accounts, restarting Alex, or failing to open the bridge requires enabling **Bidirectional design** again. Only one Alex instance per desktop profile can publish `live.json` at a time.

The **Install Antigravity plugin** button installs the designer skill and live MCP server together under `~/.gemini/config/plugins/alex-protoflow-designer`. The **Export Claude Desktop extension** button saves a `.mcpb` file. Open it in Claude Desktop and confirm the `live.json` connection file shown during setup. Both integrations only need to be installed once and follow whichever project is open in Alex Desktop.

When upgrading from a project-specific connection file, reinstall and reload the Antigravity plugin, re-export and install the Claude extension with the new path, or update the path in your manual client configuration.

For distribution, run `npm run build:integrations`. The ZIP and MCPB in `release/integrations/` include a bundled server and request the connection file path during setup. Copy that path from the desktop MCP panel. The portable Antigravity server needs Node.js 20 or newer. The locally installed plugin uses Alex's Electron runtime.

The panel also installs standalone skills. Codex uses `$CODEX_HOME/skills` when configured and `~/.agents/skills` otherwise. Reinstalling upgrades unmodified Alex files and preserves customized installations. [Antigravity plugins](https://antigravity.google/docs/build-plugins) · [MCPB manifests](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md)

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
| `protoflow_capture_preview` (desktop bridge only) | Return a PNG of the page viewport or canvas and its revision. Pass `fullPage: true` to include content below the fold. |
| `protoflow_audit_project` | Full closed-loop static audit across references, ER design, preview FK integrity, and page contracts |

## License

Apache-2.0
