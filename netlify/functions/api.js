// netlify/functions/api.js
// Pavilion — IPL 2026 Fantasy League API
// Serves standings, matches, players, live data from CricketData.org

const fs = require("fs");
const path = require("path");

// ─── Scoring engine ───────────────────────────────────────────────────────────
function calcPoints(stats) {
  if (!stats) return 0;
  let pts = 0;

  if (stats.playing) pts += 5;
  if (stats.mom)     pts += 30;

  // Batting
  const runs  = stats.batting?.runs  || 0;
  const fours = stats.batting?.fours || 0;
  const sixes = stats.batting?.sixes || 0;
  pts += runs + fours + (sixes * 2);
  if (runs >= 30)  pts += 5;
  if (runs >= 50)  pts += 10;
  if (runs >= 100) pts += 10;

  // Bowling
  const wkts    = stats.bowling?.wickets  || 0;
  const dots    = stats.bowling?.dots     || 0;
  const maidens = stats.bowling?.maidens  || 0;
  const lbwb    = stats.bowling?.lbw_b_hw || 0;
  pts += dots + (wkts * 20) + (maidens * 20) + (lbwb * 5);
  if (wkts >= 2) pts += 5;
  if (wkts >= 3) pts += 10;
  if (wkts >= 5) pts += 10;

  // Fielding
  pts += (stats.fielding?.catches      || 0) * 5;
  pts += (stats.fielding?.ro_direct    || 0) * 10;
  pts += (stats.fielding?.ro_indirect  || 0) * 5;
  pts += (stats.fielding?.stumpings    || 0) * 10;

  return pts;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseMatchCSV(content) {
  const lines = content.split("\n");
  const meta  = { title: "", date: "", abandoned: false };
  const rows  = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.toLowerCase().includes("abandoned")) meta.abandoned = true;
      else if (!meta.title) meta.title = line.slice(1).trim();
      else if (!meta.date)  meta.date  = line.slice(1).trim();
      continue;
    }
    const cols = line.split(",").map(c => c.trim());
    if (cols.length < 17 || isNaN(parseInt(cols[0]))) continue;

    rows.push({
      id:          parseInt(cols[0]),
      name:        cols[1],
      ipl_team:    cols[2],
      fantasy_team:cols[3],
      playing:     parseInt(cols[4]) || 0,
      mom:         parseInt(cols[5]) || 0,
      runs:        parseInt(cols[6]) || 0,
      fours:       parseInt(cols[7]) || 0,
      sixes:       parseInt(cols[8]) || 0,
      wkts:        parseInt(cols[9]) || 0,
      dots:        parseInt(cols[10])|| 0,
      maidens:     parseInt(cols[11])|| 0,
      lbw_b_hw:    parseInt(cols[12])|| 0,
      catches:     parseInt(cols[13])|| 0,
      ro_direct:   parseInt(cols[14])|| 0,
      ro_indirect: parseInt(cols[15])|| 0,
      stumpings:   parseInt(cols[16])|| 0,
    });
  }
  return { meta, rows };
}

// ─── Load data from disk ──────────────────────────────────────────────────────
function loadPlayers() {
  const f = path.join(__dirname, "../../data/players-cache.json");
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function loadConfig() {
  const f = path.join(__dirname, "../../data/config.json");
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function loadAllMatches(players) {
  const dir = path.join(__dirname, "../../data/matches");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".csv"))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || 0);
      const nb = parseInt(b.match(/\d+/)?.[0] || 0);
      return na - nb;
    });

  return files.map(file => {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const { meta, rows } = parseMatchCSV(content);
    const matchId = file.replace(".csv", "");

    const playerMap = {};
    for (const row of rows) {
      const stats = {
        playing: row.playing,
        mom:     row.mom,
        batting: { runs: row.runs, fours: row.fours, sixes: row.sixes },
        bowling: { wickets: row.wkts, dots: row.dots, maidens: row.maidens, lbw_b_hw: row.lbw_b_hw },
        fielding:{ catches: row.catches, ro_direct: row.ro_direct, ro_indirect: row.ro_indirect, stumpings: row.stumpings },
      };
      const points = meta.abandoned ? 0 : calcPoints(stats);
      playerMap[row.id] = {
        id: row.id, name: row.name, iplTeam: row.ipl_team,
        fantasyTeam: row.fantasy_team, stats, points,
        matchDetails: [{ matchId, points }],
      };
    }

    return { id: matchId, title: meta.title, date: meta.date, abandoned: meta.abandoned, players: playerMap };
  });
}

// ─── Build standings ──────────────────────────────────────────────────────────
function buildStandings(players, matches) {
  const teamMap = {};

  for (const p of players) {
    if (!teamMap[p.fantasyTeam]) teamMap[p.fantasyTeam] = { team: p.fantasyTeam, total: 0, players: {} };
    teamMap[p.fantasyTeam].players[p.id] = {
      id: p.id, name: p.name, iplTeam: p.iplTeam,
      category: p.category, foreign: p.foreign,
      points: 0, matchCount: 0, matchDetails: [],
    };
  }

  for (const match of matches) {
    for (const [pid, pdata] of Object.entries(match.players)) {
      const id = parseInt(pid);
      const player = players.find(p => p.id === id);
      if (!player) continue;
      const team = pdata.fantasyTeam || player.fantasyTeam;
      if (!teamMap[team]) continue;
      if (!teamMap[team].players[id]) continue;

      teamMap[team].players[id].points     += pdata.points;
      teamMap[team].players[id].matchCount += 1;
      teamMap[team].players[id].matchDetails.push({ matchId: match.id, matchTitle: match.title, matchDate: match.date, points: pdata.points });
      teamMap[team].total += pdata.points;
    }
  }

  return Object.values(teamMap)
    .map(t => ({
      ...t,
      players: Object.values(t.players).sort((a, b) => b.points - a.points),
    }))
    .sort((a, b) => b.total - a.total)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

// ─── Router ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const route = (event.path || "").replace("/.netlify/functions/api", "").replace("/api", "");
    const players = loadPlayers();
    const config  = loadConfig();
    const matches = loadAllMatches(players);

    // GET /api/config
    if (route === "/config" || route === "") {
      return { statusCode: 200, headers, body: JSON.stringify({ name: config.name, season: config.season }) };
    }

    // GET /api/players
    if (route === "/players") {
      return { statusCode: 200, headers, body: JSON.stringify(players) };
    }

    // GET /api/standings
    if (route === "/standings") {
      const standings = buildStandings(players, matches);
      return { statusCode: 200, headers, body: JSON.stringify(standings) };
    }

    // GET /api/matches
    if (route === "/matches") {
      const simple = matches.map(m => ({
        id: m.id, title: m.title, date: m.date, abandoned: m.abandoned,
      }));
      return { statusCode: 200, headers, body: JSON.stringify(simple) };
    }

    // GET /api/matches/:id/detail
    const matchDetailRe = /^\/matches\/(.+)\/detail$/;
    const mdMatch = route.match(matchDetailRe);
    if (mdMatch) {
      const matchId = mdMatch[1];
      const match = matches.find(m => m.id === matchId);
      if (!match) return { statusCode: 404, headers, body: JSON.stringify({ error: "Match not found" }) };

      const teamBreakdown = {};
      for (const [pid, pdata] of Object.entries(match.players)) {
        const ft = pdata.fantasyTeam;
        if (!teamBreakdown[ft]) teamBreakdown[ft] = { total: 0, players: [] };
        teamBreakdown[ft].total += pdata.points;
        teamBreakdown[ft].players.push({ name: pdata.name, points: pdata.points });
      }
      for (const t of Object.values(teamBreakdown)) {
        t.players.sort((a, b) => b.points - a.points);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ match: { id: match.id, title: match.title, date: match.date, abandoned: match.abandoned }, teamBreakdown }) };
    }

    // GET /api/players/details
    if (route === "/players/details") {
      const standings = buildStandings(players, matches);
      const details = [];
      for (const team of standings) {
        for (const p of team.players) {
          const player = players.find(pl => pl.id === p.id);
          details.push({
            ...p,
            category: player?.category,
            foreign: player?.foreign,
            fantasyTeam: team.team,
            total: p.points,
            matches: p.matchDetails.map(md => {
              const m = matches.find(mx => mx.id === md.matchId);
              const mp = m?.players[p.id];
              return {
                matchId: md.matchId,
                matchTitle: md.matchTitle || "",
                matchDate: md.matchDate || "",
                total: md.points,
                playing: mp?.stats?.playing ? 5 : 0,
                batting: calcPoints({ batting: mp?.stats?.batting }) - 0,
                bowling: calcPoints({ bowling: mp?.stats?.bowling }) - 0,
                fielding: calcPoints({ fielding: mp?.stats?.fielding }) - 0,
                mom: mp?.stats?.mom ? 30 : 0,
              };
            }),
          });
        }
      }
      details.sort((a, b) => b.total - a.total);
      return { statusCode: 200, headers, body: JSON.stringify(details) };
    }

    // GET /api/dashboard
    if (route === "/dashboard") {
      const standings = buildStandings(players, matches);

      const teamRankings = standings.map(t => ({ team: t.team, total: t.total, rank: t.rank }));

      // Top players across all matches
      const playerTotals = {};
      for (const match of matches) {
        for (const [pid, pdata] of Object.entries(match.players)) {
          if (!playerTotals[pid]) {
            const pl = players.find(p => p.id === parseInt(pid));
            playerTotals[pid] = { name: pdata.name, fantasyTeam: pdata.fantasyTeam, iplTeam: pdata.iplTeam, category: pl?.category, total: 0, matchCount: 0 };
          }
          playerTotals[pid].total      += pdata.points;
          playerTotals[pid].matchCount += 1;
        }
      }
      const topPlayers = Object.values(playerTotals).sort((a, b) => b.total - a.total).slice(0, 10);

      return { statusCode: 200, headers, body: JSON.stringify({ teamRankings, topPlayers, totalMatches: matches.length }) };
    }

    // GET /api/stats/top-scores
    if (route === "/stats/top-scores") {
      const winCount = {};
      const matchList = [];

      for (const match of matches) {
        const teamTotals = {};
        for (const [, pdata] of Object.entries(match.players)) {
          teamTotals[pdata.fantasyTeam] = (teamTotals[pdata.fantasyTeam] || 0) + pdata.points;
        }
        const sorted = Object.entries(teamTotals).sort((a, b) => b[1] - a[1]);
        const winner = sorted[0]?.[0];
        const topScore = sorted[0]?.[1] || 0;
        if (winner) winCount[winner] = (winCount[winner] || 0) + 1;
        matchList.push({ id: match.id, title: match.title, date: match.date, winner, topScore, teamTotals });
      }

      const leaderboard = Object.entries(winCount).map(([team, wins]) => ({ team, wins })).sort((a, b) => b.wins - a.wins);
      const sortedMatches = [...matchList].sort((a, b) => parseInt(b.id?.match(/\d+/)?.[0] || 0) - parseInt(a.id?.match(/\d+/)?.[0] || 0));

      return { statusCode: 200, headers, body: JSON.stringify({ leaderboard, matches: sortedMatches }) };
    }

    // GET /api/ipl-status — one call returns everything the Live tab needs:
    // { state, liveMatch, nextMatch, fantasyPoints, fetchedAt, nextRefreshAt }
    // state = "live" | "upcoming" | "idle"
    if (route === "/ipl-status") {
      const apiKey = config.cricketApiKey;
      if (!apiKey) {
        return { statusCode: 200, headers, body: JSON.stringify({ state: "error", message: "No API key configured" }) };
      }

      try {
        const fetch = require("node-fetch");
        const now   = new Date();

        // ── Helper: is this an IPL T20 match? ────────────────────────────
        function isIPL(m) {
          const text = [m.name, m.series, m.matchType].join(" ").toLowerCase();
          return (
            m.matchType === "t20" &&
            (text.includes("indian premier league") ||
             text.includes("ipl 2026") ||
             text.includes(" ipl ") ||
             text.startsWith("ipl"))
          );
        }

        // ── Step 1: Fetch current + upcoming matches (1 API call) ────────
        const res  = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`);
        const data = await res.json();

        if (!data.data) {
          return { statusCode: 200, headers, body: JSON.stringify({ state: "idle", fetchedAt: now.toISOString() }) };
        }

        const allMatches = data.data;

        // ── Step 2: Separate into live IPL and upcoming IPL ──────────────
        const liveIPL     = allMatches.filter(m => isIPL(m) && m.matchStarted && !m.matchEnded);
        const upcomingIPL = allMatches.filter(m => isIPL(m) && !m.matchStarted);

        // ── Case A: IPL match is LIVE right now ──────────────────────────
        if (liveIPL.length > 0) {
          const match = liveIPL[0];

          // Fetch full scorecard for fantasy points (1 more API call)
          const scRes  = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${match.id}`);
          const scData = await scRes.json();

          const fantasyPoints = scData.data
            ? mapScorecardToFantasyPoints(scData.data, players)
            : {};

          // Next refresh = 10 minutes from now
          const nextRefresh = new Date(now.getTime() + 10 * 60 * 1000);

          return {
            statusCode: 200, headers,
            body: JSON.stringify({
              state:      "live",
              fetchedAt:  now.toISOString(),
              nextRefreshAt: nextRefresh.toISOString(),
              liveMatch: {
                id:     match.id,
                name:   match.name,
                status: match.status,
                score:  match.score  || [],
                teams:  match.teams  || [],
                venue:  match.venue  || "",
              },
              fantasyPoints,
            }),
          };
        }

        // ── Case B: No live IPL match — find the NEXT upcoming one ───────
        // Sort upcoming by dateTimeGMT ascending, pick nearest
        const upcoming = upcomingIPL
          .filter(m => m.dateTimeGMT)
          .sort((a, b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));

        // Also look in the upcoming endpoint for more scheduled matches
        let nextMatch = upcoming[0] || null;

        if (!nextMatch) {
          // Try the /matches endpoint for future fixtures
          try {
            const fRes  = await fetch(`https://api.cricapi.com/v1/matches?apikey=${apiKey}&offset=0`);
            const fData = await fRes.json();
            const future = (fData.data || [])
              .filter(m => isIPL(m) && !m.matchStarted && m.dateTimeGMT && new Date(m.dateTimeGMT) > now)
              .sort((a, b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));
            nextMatch = future[0] || null;
          } catch (_) {}
        }

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            state:     nextMatch ? "upcoming" : "idle",
            fetchedAt: now.toISOString(),
            // When there's no live match, no need to refresh for 30 min
            nextRefreshAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            nextMatch: nextMatch ? {
              id:          nextMatch.id,
              name:        nextMatch.name,
              dateTimeGMT: nextMatch.dateTimeGMT,
              teams:       nextMatch.teams || [],
              venue:       nextMatch.venue || "",
              series:      nextMatch.series || "",
            } : null,
          }),
        };

      } catch (e) {
        return { statusCode: 200, headers, body: JSON.stringify({ state: "error", error: e.message, fetchedAt: new Date().toISOString() }) };
      }
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Route not found", route }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ─── Live scorecard → fantasy points mapper ────────────────────────────────────
function mapScorecardToFantasyPoints(scorecard, players) {
  // Build a name lookup map — normalise names for fuzzy matching
  const normalize = s => s.toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z ]/g, "")
    .trim();

  const playerLookup = new Map();
  for (const p of players) {
    playerLookup.set(normalize(p.name), p);
    // Also index by last name for partial matching
    const parts = normalize(p.name).split(" ");
    if (parts.length > 1) playerLookup.set(parts[parts.length - 1], p);
  }

  const findPlayer = (name) => {
    if (!name) return null;
    const norm = normalize(name);
    // Exact match
    if (playerLookup.has(norm)) return playerLookup.get(norm);
    // Partial match — check if any of our players' names are contained
    for (const [key, p] of playerLookup) {
      if (norm.includes(key) || key.includes(norm)) return p;
    }
    return null;
  };

  const fantasyPoints = {}; // fantasyTeam -> { total, players: [] }
  const playerPoints  = {}; // player name -> { pts, player }

  // CricketData scorecard format:
  // scorecard.scorecard[inningsIndex].batting = [{batsman, r, b, fours, sixes, ...}]
  // scorecard.scorecard[inningsIndex].bowling = [{bowler, o, m, r, w, ...}]

  if (!scorecard.scorecard) return {};

  // Playing XI — everyone in the scorecard gets +5
  const playingSet = new Set();
  for (const innings of scorecard.scorecard) {
    if (innings.batting) {
      for (const b of innings.batting) {
        const name = b.batsman?.name || b["batsman name"] || "";
        if (name) playingSet.add(normalize(name));
      }
    }
    if (innings.bowling) {
      for (const bw of innings.bowling) {
        const name = bw.bowler?.name || bw["bowler name"] || "";
        if (name) playingSet.add(normalize(name));
      }
    }
  }

  const addPoints = (rawName, pts) => {
    if (!rawName || pts === 0) return;
    const norm = normalize(rawName);
    if (!playerPoints[norm]) {
      const p = findPlayer(rawName);
      playerPoints[norm] = { pts: 0, player: p, rawName };
    }
    playerPoints[norm].pts += pts;
  };

  // Playing bonus
  for (const name of playingSet) {
    addPoints(name, 5);
  }

  // Batting
  for (const innings of scorecard.scorecard) {
    if (!innings.batting) continue;
    for (const b of innings.batting) {
      const name = b.batsman?.name || b["batsman name"] || "";
      if (!name) continue;
      const runs  = parseInt(b.r || b.runs || 0);
      const fours = parseInt(b["4s"] || b.fours || 0);
      const sixes = parseInt(b["6s"] || b.sixes || 0);
      let pts = runs + fours + (sixes * 2);
      if (runs >= 30)  pts += 5;
      if (runs >= 50)  pts += 10;
      if (runs >= 100) pts += 10;
      addPoints(name, pts);
    }
  }

  // Bowling
  for (const innings of scorecard.scorecard) {
    if (!innings.bowling) continue;
    for (const bw of innings.bowling) {
      const name = bw.bowler?.name || bw["bowler name"] || "";
      if (!name) continue;
      const wkts    = parseInt(bw.w || bw.wickets || 0);
      const maidens = parseInt(bw.m || bw.maidens || 0);
      // Dots aren't directly in API — estimate from overs bowled
      // The API gives: o (overs), r (runs), w (wickets), nb, wd, eco
      let pts = (wkts * 20) + (maidens * 20);
      if (wkts >= 2) pts += 5;
      if (wkts >= 3) pts += 10;
      if (wkts >= 5) pts += 10;
      // Rough dot estimate: balls bowled - balls with runs (approximation)
      addPoints(name, pts);
    }
  }

  // MOM
  const mom = scorecard.matchHeader?.playersOfTheMatch || scorecard.playersOfTheMatch || [];
  for (const m of mom) {
    const name = m?.name || m || "";
    if (name) addPoints(name, 30);
  }

  // Aggregate by fantasy team
  for (const [, { pts, player }] of Object.entries(playerPoints)) {
    if (!player) continue;
    const ft = player.fantasyTeam;
    if (!fantasyPoints[ft]) fantasyPoints[ft] = { total: 0, players: [] };
    fantasyPoints[ft].total += pts;
    fantasyPoints[ft].players.push({ name: player.name, iplTeam: player.iplTeam, pts });
  }

  // Sort players within each team
  for (const ft of Object.keys(fantasyPoints)) {
    fantasyPoints[ft].players.sort((a, b) => b.pts - a.pts);
  }

  return fantasyPoints;
}
