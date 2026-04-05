#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getPlayerProfile,
  getPlayerStats,
  getArchives,
  getGames,
  type RatingInfo,
} from "./chess-api.js";

function resolveUsername(provided: string | undefined): string {
  const username = provided ?? process.env.CHESS_USERNAME ?? "";
  if (!username) {
    throw new Error(
      "No username provided. Pass a username parameter or set the CHESS_USERNAME environment variable."
    );
  }
  return username;
}

const server = new McpServer({
  name: "chess-mcp",
  version: "1.0.0",
});

// ─── Tool: get_player_stats ───────────────────────────────────────────────────

server.tool(
  "get_player_stats",
  "Get current ratings and win/loss/draw records for a Chess.com player",
  {
    username: z
      .string()
      .optional()
      .describe("Chess.com username (falls back to CHESS_USERNAME env var)"),
  },
  async ({ username: raw }) => {
    const username = resolveUsername(raw);
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
                ? {
                    highest: stats.tactics.highest.rating,
                    lowest: stats.tactics.lowest.rating,
                  }
                : null,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: get_archives ───────────────────────────────────────────────────────

server.tool(
  "get_archives",
  "List all months with available games for a Chess.com player",
  {
    username: z
      .string()
      .optional()
      .describe("Chess.com username (falls back to CHESS_USERNAME env var)"),
  },
  async ({ username: raw }) => {
    const username = resolveUsername(raw);
    const archives = await getArchives(username);
    const formatted = archives.map((url) => {
      const parts = url.split("/");
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ username, archives: formatted }, null, 2),
        },
      ],
    };
  }
);

// ─── Tool: get_games ──────────────────────────────────────────────────────────

server.tool(
  "get_games",
  "Get games played in a specific month, with optional filters by result or color",
  {
    year: z.number().int().min(2000).max(2100).describe("Year (e.g. 2026)"),
    month: z.number().int().min(1).max(12).describe("Month number (1–12)"),
    username: z
      .string()
      .optional()
      .describe("Chess.com username (falls back to CHESS_USERNAME env var)"),
    result_filter: z
      .enum(["win", "loss", "draw"])
      .optional()
      .describe("Filter games by outcome"),
    color_filter: z
      .enum(["white", "black"])
      .optional()
      .describe("Filter by color played"),
  },
  async ({ year, month, username: raw, result_filter, color_filter }) => {
    const username = resolveUsername(raw);
    const games = await getGames(username, year, month);

    const enriched = games.map((g) => {
      const color =
        g.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
      const opponent_color = color === "white" ? "black" : "white";
      const my_result = g[color].result;
      const is_win = my_result === "win";
      const is_loss = ["checkmated", "timeout", "resigned", "abandoned", "lose"].includes(my_result);
      const outcome = is_win ? "win" : is_loss ? "loss" : "draw";

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
      };
    });

    let filtered = enriched;
    if (result_filter) filtered = filtered.filter((g) => g.outcome === result_filter);
    if (color_filter) filtered = filtered.filter((g) => g.color === color_filter);

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
);

// ─── Tool: analyze_month ──────────────────────────────────────────────────────

server.tool(
  "analyze_month",
  "Full performance analysis for a specific month: win rates by color, how games ended, rating progression",
  {
    year: z.number().int().min(2000).max(2100).describe("Year (e.g. 2026)"),
    month: z.number().int().min(1).max(12).describe("Month number (1–12)"),
    username: z
      .string()
      .optional()
      .describe("Chess.com username (falls back to CHESS_USERNAME env var)"),
  },
  async ({ year, month, username: raw }) => {
    const username = resolveUsername(raw);
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

    const stats = {
      total: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      as_white: { total: 0, wins: 0, losses: 0, draws: 0 },
      as_black: { total: 0, wins: 0, losses: 0, draws: 0 },
      endings: {} as Record<string, number>,
      rating_start: 0,
      rating_end: 0,
      rating_peak: 0,
      rating_low: Infinity,
    };

    const sorted = [...games].sort((a, b) => a.end_time - b.end_time);

    for (const g of sorted) {
      const color =
        g.white.username.toLowerCase() === username.toLowerCase() ? "white" : "black";
      const my_result = g[color].result;
      const is_win = my_result === "win";
      const is_loss = ["checkmated", "timeout", "resigned", "abandoned", "lose"].includes(my_result);
      const outcome = is_win ? "wins" : is_loss ? "losses" : "draws";
      const my_rating = g[color].rating;

      stats.total++;
      stats[outcome]++;
      stats[`as_${color}`].total++;
      stats[`as_${color}`][outcome]++;
      stats.endings[my_result] = (stats.endings[my_result] ?? 0) + 1;

      if (stats.rating_start === 0) stats.rating_start = my_rating;
      stats.rating_end = my_rating;
      if (my_rating > stats.rating_peak) stats.rating_peak = my_rating;
      if (my_rating < stats.rating_low) stats.rating_low = my_rating;
    }

    const winRate = (w: number, t: number) =>
      t > 0 ? `${((w / t) * 100).toFixed(1)}%` : "N/A";

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
              rating_progression: {
                start: stats.rating_start,
                end: stats.rating_end,
                peak: stats.rating_peak,
                low: stats.rating_low === Infinity ? null : stats.rating_low,
                change: stats.rating_end - stats.rating_start,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

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
