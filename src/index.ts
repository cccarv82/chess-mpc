#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getPlayerProfile,
  getPlayerStats,
  getArchives,
  getGames,
  type RatingInfo,
  type Game,
} from "./chess-api.js";

function resolveUsername(provided: unknown): string {
  const username =
    (typeof provided === "string" ? provided : "") ||
    process.env.CHESS_USERNAME ||
    "";
  if (!username) {
    throw new Error(
      "No username provided. Pass a username parameter or set the CHESS_USERNAME environment variable."
    );
  }
  return username;
}

function classifyResult(result: string): "win" | "loss" | "draw" {
  if (result === "win") return "win";
  if (["checkmated", "timeout", "resigned", "abandoned", "lose"].includes(result))
    return "loss";
  return "draw";
}

function parseOpeningFromPgn(pgn: string): string | null {
  const match = pgn.match(/\[Opening "([^"]+)"\]/);
  return match ? match[1] : null;
}

function parseEcoFromPgn(pgn: string): string | null {
  const match = pgn.match(/\[ECO "([^"]+)"\]/);
  return match ? match[1] : null;
}

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "chess-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions (clean schema — no $schema, no execution fields) ────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_player_stats",
      description: "Get current ratings and win/loss/draw records for a Chess.com player",
      inputSchema: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "Chess.com username (falls back to CHESS_USERNAME env var)",
          },
        },
      },
    },
    {
      name: "get_archives",
      description: "List all months with available games for a Chess.com player",
      inputSchema: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "Chess.com username (falls back to CHESS_USERNAME env var)",
          },
        },
      },
    },
    {
      name: "get_games",
      description:
        "Get games played in a specific month, with optional filters by result, color, and time class. Includes full PGN.",
      inputSchema: {
        type: "object",
        properties: {
          year: { type: "number", description: "Year (e.g. 2026)" },
          month: { type: "number", description: "Month number (1–12)" },
          username: {
            type: "string",
            description: "Chess.com username (falls back to CHESS_USERNAME env var)",
          },
          result_filter: {
            type: "string",
            enum: ["win", "loss", "draw"],
            description: "Filter games by outcome",
          },
          color_filter: {
            type: "string",
            enum: ["white", "black"],
            description: "Filter by color played",
          },
          time_class_filter: {
            type: "string",
            enum: ["rapid", "blitz", "bullet", "daily"],
            description: "Filter by time control format",
          },
        },
        required: ["year", "month"],
      },
    },
    {
      name: "get_recent_games",
      description:
        "Get games from the last N days without needing to specify year/month. Useful for post-session review.",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to look back (default: 7)",
          },
          username: {
            type: "string",
            description: "Chess.com username (falls back to CHESS_USERNAME env var)",
          },
          time_class_filter: {
            type: "string",
            enum: ["rapid", "blitz", "bullet", "daily"],
            description: "Filter by time control format",
          },
        },
      },
    },
    {
      name: "analyze_month",
      description:
        "Full performance analysis for a specific month: win rates by color, how games ended, rating progression curve, and opening stats.",
      inputSchema: {
        type: "object",
        properties: {
          year: { type: "number", description: "Year (e.g. 2026)" },
          month: { type: "number", description: "Month number (1–12)" },
          username: {
            type: "string",
            description: "Chess.com username (falls back to CHESS_USERNAME env var)",
          },
        },
        required: ["year", "month"],
      },
    },
  ],
}));

// ─── Tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  if (name === "get_player_stats") {
    const username = resolveUsername(a.username);
    const [profile, stats] = await Promise.all([
      getPlayerProfile(username),
      getPlayerStats(username),
    ]);

    const formatRating = (info: RatingInfo | undefined) => {
      if (!info) return null;
      const total = info.record.win + info.record.loss + info.record.draw;
      return {
        current: info.last.rating,
        best: info.best.rating,
        best_game: info.best.game,
        record: info.record,
        win_rate: total > 0 ? `${((info.record.win / total) * 100).toFixed(1)}%` : "N/A",
      };
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              username: profile.username,
              league: profile.league,
              followers: profile.followers,
              joined: new Date(profile.joined * 1000).toISOString().split("T")[0],
              last_online: new Date(profile.last_online * 1000).toISOString().split("T")[0],
              ratings: {
                rapid: formatRating(stats.chess_rapid),
                blitz: formatRating(stats.chess_blitz),
                bullet: formatRating(stats.chess_bullet),
                daily: formatRating(stats.chess_daily),
              },
              fide: stats.fide || null,
              tactics: stats.tactics
                ? { highest: stats.tactics.highest.rating, lowest: stats.tactics.lowest.rating }
                : null,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "get_archives") {
    const username = resolveUsername(a.username);
    const archives = await getArchives(username);
    const formatted = archives.map((url) => {
      const parts = url.split("/");
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    });
    return {
      content: [
        { type: "text", text: JSON.stringify({ username, archives: formatted }, null, 2) },
      ],
    };
  }

  if (name === "get_games") {
    const username = resolveUsername(a.username);
    const year = Number(a.year);
    const month = Number(a.month);
    const result_filter = a.result_filter as string | undefined;
    const color_filter = a.color_filter as string | undefined;
    const time_class_filter = a.time_class_filter as string | undefined;

    const games = await getGames(username, year, month);
    const enriched = enrichGames(games, username);

    let filtered = enriched;
    if (result_filter) filtered = filtered.filter((g) => g.outcome === result_filter);
    if (color_filter) filtered = filtered.filter((g) => g.color === color_filter);
    if (time_class_filter) filtered = filtered.filter((g) => g.time_class === time_class_filter);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              username,
              period: `${year}/${String(month).padStart(2, "0")}`,
              total: filtered.length,
              games: filtered,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "get_recent_games") {
    const username = resolveUsername(a.username);
    const days = typeof a.days === "number" ? a.days : 7;
    const time_class_filter = a.time_class_filter as string | undefined;

    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const archives = await getArchives(username);

    // Determine which months overlap with the requested window
    const monthsToFetch = new Set<string>();
    const now = new Date();
    for (let d = 0; d <= days + 31; d += 28) {
      const dt = new Date(cutoff + d * 24 * 60 * 60 * 1000);
      monthsToFetch.add(`${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}`);
    }
    monthsToFetch.add(
      `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`
    );

    const relevantArchives = archives.filter((url) => {
      const parts = url.split("/");
      const key = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
      return monthsToFetch.has(key);
    });

    const gameArrays = await Promise.all(
      relevantArchives.map((url) => {
        const parts = url.split("/");
        return getGames(username, Number(parts[parts.length - 2]), Number(parts[parts.length - 1]));
      })
    );

    const allGames = gameArrays.flat();
    const recent = allGames.filter((g) => g.end_time * 1000 >= cutoff);
    const enriched = enrichGames(recent, username);

    let filtered = enriched;
    if (time_class_filter) filtered = filtered.filter((g) => g.time_class === time_class_filter);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { username, last_days: days, total: filtered.length, games: filtered },
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "analyze_month") {
    const username = resolveUsername(a.username);
    const year = Number(a.year);
    const month = Number(a.month);
    const games = await getGames(username, year, month);

    if (games.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              username,
              period: `${year}/${String(month).padStart(2, "0")}`,
              message: "No games found for this period.",
            }),
          },
        ],
      };
    }

    const sorted = [...games].sort((a, b) => a.end_time - b.end_time);

    const stats = {
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      as_white: { total: 0, wins: 0, losses: 0, draws: 0 },
      as_black: { total: 0, wins: 0, losses: 0, draws: 0 },
      endings: {} as Record<string, number>,
      openings: {} as Record<string, { total: number; wins: number; losses: number; draws: number }>,
      rating_start: 0,
      rating_end: 0,
      rating_peak: 0,
      rating_low: Infinity,
      rating_curve: [] as number[],
    };

    for (const g of sorted) {
      const color =
        g.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
      const my_result = g[color].result;
      const outcome = classifyResult(my_result);
      const outcomeKey = outcome === "win" ? "wins" : outcome === "loss" ? "losses" : "draws";
      const my_rating = g[color].rating;

      stats.total++;
      stats[outcomeKey]++;
      stats[`as_${color}`].total++;
      stats[`as_${color}`][outcomeKey]++;
      stats.endings[my_result] = (stats.endings[my_result] ?? 0) + 1;

      const opening = parseOpeningFromPgn(g.pgn) ?? parseEcoFromPgn(g.pgn) ?? "Unknown";
      if (!stats.openings[opening]) {
        stats.openings[opening] = { total: 0, wins: 0, losses: 0, draws: 0 };
      }
      stats.openings[opening].total++;
      stats.openings[opening][outcomeKey]++;

      if (stats.rating_start === 0) stats.rating_start = my_rating;
      stats.rating_end = my_rating;
      if (my_rating > stats.rating_peak) stats.rating_peak = my_rating;
      if (my_rating < stats.rating_low) stats.rating_low = my_rating;
      stats.rating_curve.push(my_rating);
    }

    const winRate = (w: number, t: number) =>
      t > 0 ? `${((w / t) * 100).toFixed(1)}%` : "N/A";

    const topOpenings = Object.entries(stats.openings)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, s]) => ({
        opening: name,
        total: s.total,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        win_rate: winRate(s.wins, s.total),
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              username,
              period: `${year}/${String(month).padStart(2, "0")}`,
              total_games: stats.total,
              overall: {
                wins: stats.wins,
                losses: stats.losses,
                draws: stats.draws,
                win_rate: winRate(stats.wins, stats.total),
              },
              as_white: {
                ...stats.as_white,
                win_rate: winRate(stats.as_white.wins, stats.as_white.total),
              },
              as_black: {
                ...stats.as_black,
                win_rate: winRate(stats.as_black.wins, stats.as_black.total),
              },
              how_games_ended: stats.endings,
              top_openings: topOpenings,
              rating_progression: {
                start: stats.rating_start,
                end: stats.rating_end,
                peak: stats.rating_peak,
                low: stats.rating_low === Infinity ? null : stats.rating_low,
                change: stats.rating_end - stats.rating_start,
                curve: stats.rating_curve,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enrichGames(games: Game[], username: string) {
  return games.map((g) => {
    const color =
      g.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
    const opponent_color = color === "white" ? "black" : "white";
    const my_result = g[color].result;
    const outcome = classifyResult(my_result);

    return {
      url: g.url,
      date: new Date(g.end_time * 1000).toISOString().split("T")[0],
      color,
      my_rating: g[color].rating,
      opponent: g[opponent_color].username,
      opponent_rating: g[opponent_color].rating,
      result: my_result,
      outcome,
      time_class: g.time_class,
      time_control: g.time_control,
      opening: parseOpeningFromPgn(g.pgn) ?? parseEcoFromPgn(g.pgn) ?? null,
      pgn: g.pgn,
    };
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Chess MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
