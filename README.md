# chess-mcp

MCP server that connects Claude to the Chess.com public API, giving direct access to game history and performance analysis.

## Tools

| Tool | Description |
|------|-------------|
| `get_player_stats` | Current ratings, W/L/D record, best game |
| `get_archives` | List all months with available games |
| `get_games` | Games from a specific month (with filters by color/result) |
| `analyze_month` | Full analysis: win rates by color, how games ended, rating progression |

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

Add the following to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json` or via `claude mcp add`):

```json
{
  "mcpServers": {
    "chess": {
      "command": "node",
      "args": ["/absolute/path/to/chess-mpc/dist/index.js"],
      "env": {
        "CHESS_USERNAME": "your-chess-com-username"
      }
    }
  }
}
```

Or using the Claude Code CLI:

```bash
claude mcp add chess node /absolute/path/to/chess-mpc/dist/index.js
```

> Set `CHESS_USERNAME` in the `env` block so you don't need to pass it on every request.

## Usage examples

Once connected, you can ask Claude things like:

- *"Como foi meu desempenho em fevereiro de 2026?"*
- *"Quais foram meus jogos com as pretas em 2026?"*
- *"Qual meu rating atual no rapid?"*
- *"Em quais partidas fui derrotado por xeque-mate esse mês?"*

## Development

```bash
npm run dev   # run with tsx (no build needed)
npm run build # compile TypeScript to dist/
```
