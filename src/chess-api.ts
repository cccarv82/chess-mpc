const BASE_URL = "https://api.chess.com/pub";
const HEADERS = {
  "User-Agent": "chess-mcp/1.0.0 (github.com/cccarv/chess-mcp)",
};

export interface PlayerProfile {
  player_id: number;
  username: string;
  url: string;
  followers: number;
  country: string;
  last_online: number;
  joined: number;
  status: string;
  league: string;
}

export interface GameRecord {
  win: number;
  loss: number;
  draw: number;
}

export interface RatingInfo {
  last: { rating: number; date: number; rd: number };
  best: { rating: number; date: number; game: string };
  record: GameRecord;
}

export interface PlayerStats {
  chess_rapid?: RatingInfo;
  chess_blitz?: RatingInfo;
  chess_bullet?: RatingInfo;
  chess_daily?: RatingInfo;
  tactics?: {
    highest: { rating: number; date: number };
    lowest: { rating: number; date: number };
  };
  fide?: number;
}

export interface GamePlayer {
  username: string;
  rating: number;
  result: string;
  "@id": string;
}

export interface Game {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: GamePlayer;
  black: GamePlayer;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(
      `Chess.com API error: ${res.status} ${res.statusText} — ${url}`
    );
  }
  return res.json() as Promise<T>;
}

export async function getPlayerProfile(username: string): Promise<PlayerProfile> {
  return fetchJson<PlayerProfile>(`${BASE_URL}/player/${username}`);
}

export async function getPlayerStats(username: string): Promise<PlayerStats> {
  return fetchJson<PlayerStats>(`${BASE_URL}/player/${username}/stats`);
}

export async function getArchives(username: string): Promise<string[]> {
  const data = await fetchJson<{ archives: string[] }>(
    `${BASE_URL}/player/${username}/games/archives`
  );
  return data.archives ?? [];
}

export async function getGames(
  username: string,
  year: number,
  month: number
): Promise<Game[]> {
  const mm = String(month).padStart(2, "0");
  const data = await fetchJson<{ games: Game[] }>(
    `${BASE_URL}/player/${username}/games/${year}/${mm}`
  );
  return data.games ?? [];
}
