# chess-mcp

MCP server that connects Claude to the Chess.com public API, giving direct access to game history and performance analysis.

## Tools

| Tool | Description |
|------|-------------|
| `get_player_stats` | Current ratings, W/L/D record, best game |
| `get_archives` | List all months with available games |
| `get_games` | Games from a specific month (filters: color, result, time class). Includes full PGN. |
| `get_recent_games` | Games from the last N days — no need to specify year/month |
| `analyze_month` | Full analysis: win rates by color, how games ended, opening stats, rating curve |

All tools accept an optional `username` parameter. If omitted, the `CHESS_USERNAME` environment variable is used. At least one must be set.

## Prerequisites

- Node.js 18+
- npm

## Installation

```bash
git clone https://github.com/cccarv82/chess-mpc.git
cd chess-mpc
npm install
npm run build
```

## Add to Claude Code

The recommended way is via the Claude Code CLI — this writes to the correct registry file regardless of platform:

```bash
claude mcp add chess node "/absolute/path/to/chess-mpc/dist/index.js" -e CHESS_USERNAME=your-username
```

> **Windows + fnm/nvm users:** `node` may not resolve when Claude Code spawns the server (GUI apps don't inherit shell PATH). Use the absolute path to your node executable instead:
>
> ```bash
> # Find your node path
> which node    # e.g. /c/Users/You/AppData/Roaming/fnm/node-versions/v20.20.1/installation/node.exe
>
> claude mcp add chess "C:/Users/You/AppData/Roaming/fnm/node-versions/v20.20.1/installation/node.exe" "E:/chess-mpc/dist/index.js" -e CHESS_USERNAME=your-username
> ```

Verify the server is connected:

```bash
claude mcp list
# chess: ... - ✓ Connected
```

### Manual config (alternative)

If you prefer editing config files directly, add to `~/.claude.json` under your project's `mcpServers` key — but the CLI method above is simpler and less error-prone.

## Usage examples

Once connected, you can ask Claude things like:

- *"Como foi meu desempenho em fevereiro de 2026?"*
- *"Quais foram meus jogos com as pretas esse mês?"*
- *"Qual meu rating atual no rapid?"*
- *"Analisa meus últimos 7 dias de partidas"*
- *"Com quais aberturas tenho mais vitórias?"*

## Troubleshooting

### Verify tools are registering

Test the server manually via JSON-RPC:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node dist/index.js
```

You should see a `tools/list` response with all 5 tools listed.

### Check MCP status in Claude Code

```bash
claude mcp list
```

The server should appear as `✓ Connected`. If tools still don't show up, verify you're on a compatible SDK version:

```bash
npm list @modelcontextprotocol/sdk
```

This server uses the low-level `Server` API (not `McpServer`) to avoid schema fields injected by newer SDK versions that Claude Code does not recognize.

### Environment variable not picked up

Make sure `CHESS_USERNAME` is set in the `env` block of your MCP config, not just in your shell. Claude Code spawns the server in its own environment.

## Development

```bash
npm run dev   # run with tsx (no build needed)
npm run build # compile TypeScript to dist/
```
