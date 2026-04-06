// netlify/functions/api.js -- Pavilion IPL 2026 Fantasy League API
// Uses require() for JSON data -- Netlify bundles these at build time

const fs   = require("fs");
const path = require("path");

// require() is bundled correctly by Netlify -- no path issues
const PLAYERS = require("../../data/players-cache.json");
const CONFIG  = require("../../data/config.json");

// --- Scoring ---
function calcPoints(stats) {
  if (!stats) return 0;
  let pts = 0;
  if (stats.playing) pts += 5;
  if (stats.mom)     pts += 30;
  const b = stats.batting || {};
  const runs = b.runs || 0; const fours = b.fours || 0; const sixes = b.sixes || 0;
  pts += runs + fours + (sixes * 2);
  if (runs >= 30) pts += 5; if (runs >= 50) pts += 10; if (runs >= 100) pts += 10;
  const w = stats.bowling || {};
  const wkts = w.wickets || w.wkts || 0; const dots = w.dots || 0; const maidens = w.maidens || 0; const lbwb = w.lbw_b_hw || 0;
  pts += dots + (wkts * 20) + (maidens * 20) + (lbwb * 5);
  if (wkts >= 2) pts += 5; if (wkts >= 3) pts += 10; if (wkts >= 5) pts += 10;
  const f = stats.fielding || {};
  pts += (f.catches || 0) * 5 + (f.ro_direct || 0) * 10 + (f.ro_indirect || 0) * 5 + (f.stumpings || 0) * 10;
  return pts;
}

// --- CSV parser ---
function parseMatchCSV(content) {
  const meta = { title: "", date: "", abandoned: false };
  const rows = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      if (line.toLowerCase().includes("abandoned")) meta.abandoned = true;
      else if (!meta.title) meta.title = line.slice(1).trim();
      else if (!meta.date)  meta.date  = line.slice(1).trim();
      continue;
    }
    const c = line.split(",").map(s => s.trim());
    if (c.length < 17 || isNaN(parseInt(c[0]))) continue;
    rows.push({
      id: parseInt(c[0]), name: c[1], ipl_team: c[2], fantasy_team: c[3],
      playing: +c[4]||0, mom: +c[5]||0, runs: +c[6]||0, fours: +c[7]||0,
      sixes: +c[8]||0, wkts: +c[9]||0, dots: +c[10]||0, maidens: +c[11]||0,
      lbw_b_hw: +c[12]||0, catches: +c[13]||0, ro_direct: +c[14]||0,
      ro_indirect: +c[15]||0, stumpings: +c[16]||0,
    });
  }
  return { meta, rows };
}

// --- Load CSV matches from disk ---
function loadAllMatches() {
  const dirs = [
    path.join(__dirname, "../../data/matches"),
    path.join(process.cwd(), "data/matches"),
    "/var/task/data/matches",
  ];
  let dir = null;
  for (const d of dirs) { try { if (fs.existsSync(d)) { dir = d; break; } } catch(_) {} }
  if (!dir) return [];
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith(".csv")).sort((a,b) => parseInt((a.match(/\d+/)||[0])[0]) - parseInt((b.match(/\d+/)||[0])[0])); }
  catch(_) { return []; }
  const matches = [];
  for (const file of files) {
    try {
      const { meta, rows } = parseMatchCSV(fs.readFileSync(path.join(dir, file), "utf8"));
      const playerMap = {};
      for (const r of rows) {
        const stats = {
          playing: r.playing, mom: r.mom,
          batting: { runs: r.runs, fours: r.fours, sixes: r.sixes },
          bowling: { wickets: r.wkts, dots: r.dots, maidens: r.maidens, lbw_b_hw: r.lbw_b_hw },
          fielding: { catches: r.catches, ro_direct: r.ro_direct, ro_indirect: r.ro_indirect, stumpings: r.stumpings },
        };
        playerMap[r.id] = { id: r.id, name: r.name, iplTeam: r.ipl_team, fantasyTeam: r.fantasy_team, stats, points: meta.abandoned ? 0 : calcPoints(stats) };
      }
      matches.push({ id: file.replace(".csv",""), title: meta.title, date: meta.date, abandoned: meta.abandoned, players: playerMap });
    } catch(_) {}
  }
  return matches;
}

// --- Build standings ---
function buildStandings(players, matches) {
  const tm = {};
  for (const p of players) {
    if (!tm[p.fantasyTeam]) tm[p.fantasyTeam] = { team: p.fantasyTeam, total: 0, players: {} };
    tm[p.fantasyTeam].players[p.id] = { id: p.id, name: p.name, iplTeam: p.iplTeam, category: p.category, foreign: p.foreign, points: 0, matchCount: 0, matchDetails: [] };
  }
  for (const m of matches) {
    for (const [pid, pd] of Object.entries(m.players)) {
      const id = parseInt(pid);
      const pl = players.find(p => p.id === id);
      if (!pl) continue;
      const ft = pd.fantasyTeam || pl.fantasyTeam;
      if (!tm[ft] || !tm[ft].players[id]) continue;
      tm[ft].players[id].points += pd.points;
      tm[ft].players[id].matchCount += 1;
      tm[ft].players[id].matchDetails.push({ matchId: m.id, matchTitle: m.title, matchDate: m.date, points: pd.points });
      tm[ft].total += pd.points;
    }
  }
  return Object.values(tm)
    .map(t => ({ ...t, players: Object.values(t.players).sort((a,b) => b.points - a.points) }))
    .sort((a,b) => b.total - a.total)
    .map((t,i) => ({ ...t, rank: i+1 }));
}

// --- IPL detector ---
function isIPL(m) {
  const txt = [m.name||"", m.series||"", m.matchType||""].join(" ").toLowerCase();
  return m.matchType === "t20" && (txt.includes("indian premier league") || txt.includes("ipl 2026") || txt.includes(" ipl ") || txt.startsWith("ipl"));
}

// --- Scorecard -> fantasy points ---
function mapToFantasy(scorecard, players) {
  const norm = s => (s||"").toLowerCase().replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();
  const lk = new Map();
  for (const p of players) {
    lk.set(norm(p.name), p);
    const pts = norm(p.name).split(" ");
    if (pts.length > 1 && !lk.has(pts[pts.length-1])) lk.set(pts[pts.length-1], p);
  }
  const find = name => {
    const n = norm(name); if (!n) return null;
    if (lk.has(n)) return lk.get(n);
    for (const [k,p] of lk) { if (n.includes(k) || k.includes(n)) return p; }
    return null;
  };
  const acc = {};
  const add = (rawName, pts) => {
    if (!rawName || !pts) return;
    const n = norm(rawName);
    if (!acc[n]) acc[n] = { pts: 0, player: find(rawName) };
    acc[n].pts += pts;
  };
  for (const inn of (scorecard.scorecard||[])) {
    for (const b of (inn.batting||[])) {
      const name = b["batsman name"] || (b.batsman&&b.batsman.name) || "";
      add(name, 5); // playing
      const runs=+(b.r||b.runs||0), fours=+(b["4s"]||b.fours||0), sixes=+(b["6s"]||b.sixes||0);
      let p = runs + fours + sixes*2;
      if (runs>=30) p+=5; if (runs>=50) p+=10; if (runs>=100) p+=10;
      add(name, p);
    }
    for (const bw of (inn.bowling||[])) {
      const name = bw["bowler name"] || (bw.bowler&&bw.bowler.name) || "";
      add(name, 5); // playing
      const wk=+(bw.w||bw.wickets||0), mai=+(bw.m||bw.maidens||0);
      let p = wk*20 + mai*20;
      if (wk>=2) p+=5; if (wk>=3) p+=10; if (wk>=5) p+=10;
      add(name, p);
    }
  }
  for (const m of ((scorecard.matchHeader&&scorecard.matchHeader.playersOfTheMatch)||scorecard.playersOfTheMatch||[])) {
    add(m.name||m||"", 30);
  }
  const result = {};
  for (const [, { pts, player }] of Object.entries(acc)) {
    if (!player) continue;
    const ft = player.fantasyTeam;
    if (!result[ft]) result[ft] = { total: 0, players: [] };
    result[ft].total += pts;
    result[ft].players.push({ name: player.name, iplTeam: player.iplTeam, pts });
  }
  for (const ft of Object.keys(result)) result[ft].players.sort((a,b) => b.pts - a.pts);
  return result;
}

// --- HANDLER ---
exports.handler = async (event) => {
  const H = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const ok  = b => ({ statusCode: 200, headers: H, body: JSON.stringify(b) });
  const e404 = m => ({ statusCode: 404, headers: H, body: JSON.stringify({ error: m }) });

  try {
    const route   = (event.path||"").replace("/.netlify/functions/api","").replace("/api","").split("?")[0] || "/";
    const players = PLAYERS;
    const config  = CONFIG;
    const matches = loadAllMatches();

    if (route === "/config" || route === "/" || route === "") return ok({ name: config.name, season: config.season });
    if (route === "/players") return ok(players);
    if (route === "/standings") return ok(buildStandings(players, matches));
    if (route === "/matches") return ok(matches.map(m => ({ id:m.id, title:m.title, date:m.date, abandoned:m.abandoned })));

    const mdM = route.match(/^\/matches\/(.+)\/detail$/);
    if (mdM) {
      const match = matches.find(m => m.id === mdM[1]);
      if (!match) return e404("Match not found");
      const bd = {};
      for (const [,pd] of Object.entries(match.players)) {
        if (!bd[pd.fantasyTeam]) bd[pd.fantasyTeam] = { total:0, players:[] };
        bd[pd.fantasyTeam].total += pd.points;
        bd[pd.fantasyTeam].players.push({ name:pd.name, points:pd.points });
      }
      for (const t of Object.values(bd)) t.players.sort((a,b) => b.points-a.points);
      return ok({ match:{ id:match.id, title:match.title, date:match.date, abandoned:match.abandoned }, teamBreakdown:bd });
    }

    if (route === "/players/details") {
      const st = buildStandings(players, matches);
      const details = [];
      for (const team of st) {
        for (const p of team.players) {
          const pl = players.find(x => x.id === p.id);
          details.push({ ...p, category: pl?pl.category:"", foreign: pl?pl.foreign:"", fantasyTeam:team.team, total:p.points,
            matches: p.matchDetails.map(md => {
              const mx = matches.find(m => m.id===md.matchId);
              const mp = mx ? mx.players[p.id] : null;
              return { matchId:md.matchId, matchTitle:md.matchTitle||"", matchDate:md.matchDate||"", total:md.points,
                playing: mp&&mp.stats&&mp.stats.playing?5:0,
                batting: mp?calcPoints({batting:mp.stats.batting}):0,
                bowling: mp?calcPoints({bowling:mp.stats.bowling}):0,
                fielding:mp?calcPoints({fielding:mp.stats.fielding}):0,
                mom: mp&&mp.stats&&mp.stats.mom?30:0 };
            }),
          });
        }
      }
      details.sort((a,b) => b.total-a.total);
      return ok(details);
    }

    if (route === "/dashboard") {
      const st = buildStandings(players, matches);
      const totals = {};
      for (const m of matches) {
        for (const [pid,pd] of Object.entries(m.players)) {
          if (!totals[pid]) { const pl=players.find(p=>p.id===parseInt(pid)); totals[pid]={name:pd.name,fantasyTeam:pd.fantasyTeam,iplTeam:pd.iplTeam,category:pl?pl.category:"",total:0,matchCount:0}; }
          totals[pid].total+=pd.points; totals[pid].matchCount+=1;
        }
      }
      return ok({ teamRankings:st.map(t=>({team:t.team,total:t.total,rank:t.rank})), topPlayers:Object.values(totals).sort((a,b)=>b.total-a.total).slice(0,10), totalMatches:matches.length });
    }

    if (route === "/stats/top-scores") {
      const wc={}, ml=[];
      for (const m of [...matches].reverse()) {
        const tt={};
        for (const [,pd] of Object.entries(m.players)) tt[pd.fantasyTeam]=(tt[pd.fantasyTeam]||0)+pd.points;
        const sorted=Object.entries(tt).sort((a,b)=>b[1]-a[1]);
        const winner=sorted[0]?sorted[0][0]:null; const topScore=sorted[0]?sorted[0][1]:0;
        if (winner) wc[winner]=(wc[winner]||0)+1;
        ml.push({id:m.id,title:m.title,date:m.date,winner,topScore,teamTotals:tt});
      }
      return ok({ leaderboard:Object.entries(wc).map(([team,wins])=>({team,wins})).sort((a,b)=>b.wins-a.wins), matches:ml });
    }

    if (route === "/ipl-status") {
      const apiKey = process.env.CRICKET_API_KEY || config.cricketApiKey;
      if (!apiKey) return ok({ state:"error", message:"Set CRICKET_API_KEY in Netlify environment variables" });
      const fetch = require("node-fetch");
      const now   = new Date();
      const res   = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`);
      const data  = await res.json();
      const all   = data.data || [];
      const liveIPL     = all.filter(m => isIPL(m) && m.matchStarted && !m.matchEnded);
      const upcomingIPL = all.filter(m => isIPL(m) && !m.matchStarted);
      if (liveIPL.length > 0) {
        const match = liveIPL[0];
        const scRes = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${match.id}`);
        const scData= await scRes.json();
        return ok({ state:"live", fetchedAt:now.toISOString(), nextRefreshAt:new Date(now.getTime()+10*60*1000).toISOString(),
          liveMatch:{ id:match.id, name:match.name, status:match.status, score:match.score||[], teams:match.teams||[], venue:match.venue||"" },
          fantasyPoints: scData.data ? mapToFantasy(scData.data, players) : {} });
      }
      let nextMatch = upcomingIPL.filter(m=>m.dateTimeGMT).sort((a,b)=>new Date(a.dateTimeGMT)-new Date(b.dateTimeGMT))[0] || null;
      if (!nextMatch) {
        try {
          const fRes = await fetch(`https://api.cricapi.com/v1/matches?apikey=${apiKey}&offset=0`);
          const fData= await fRes.json();
          nextMatch = (fData.data||[]).filter(m=>isIPL(m)&&!m.matchStarted&&m.dateTimeGMT&&new Date(m.dateTimeGMT)>now).sort((a,b)=>new Date(a.dateTimeGMT)-new Date(b.dateTimeGMT))[0]||null;
        } catch(_){}
      }
      return ok({ state:nextMatch?"upcoming":"idle", fetchedAt:now.toISOString(), nextRefreshAt:new Date(now.getTime()+30*60*1000).toISOString(),
        nextMatch: nextMatch?{id:nextMatch.id,name:nextMatch.name,dateTimeGMT:nextMatch.dateTimeGMT,teams:nextMatch.teams||[],venue:nextMatch.venue||"",series:nextMatch.series||""}:null });
    }

    return e404("Unknown route: " + route);

  } catch(e) {
    console.error("[api] CRASH:", e.message, e.stack);
    return { statusCode:500, headers:H, body:JSON.stringify({ error:e.message }) };
  }
};
