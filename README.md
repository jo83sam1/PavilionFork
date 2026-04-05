# 🏏 Pavilion — IPL 2026 Fantasy League

A self-hosted fantasy cricket tracker with **live score integration** via CricketData.org.

![Pavilion](https://img.shields.io/badge/IPL_2026-Fantasy_League-6366f1?style=for-the-badge)
![Free](https://img.shields.io/badge/Hosting-100%25_Free-10b981?style=for-the-badge)
![Live](https://img.shields.io/badge/Live_Scores-CricketData.org-f59e0b?style=for-the-badge)

---

## ✨ Features

- **📊 Standings** — Live team leaderboard with match win counts
- **🏏 Matches** — Match-by-match breakdown with player points
- **🏅 Teams** — Accordion view of each fantasy team's roster and points
- **👤 Players** — All 120 players ranked by total fantasy points
- **🔴 Live** — Auto-refreshing live fantasy points during IPL matches (every 2 mins)
- **📋 Rules** — Scoring rules & prize distribution

---

## 🚀 Quick Start (Local)

```bash
git clone https://github.com/jo83sam1/pavilion.git
cd pavilion
npm install
npm start
# Open http://localhost:3001
```

---

## 🌐 Deploy to Netlify (Free)

1. Push this repo to GitHub
2. Go to [netlify.com](https://netlify.com) → New site from Git
3. Select your repo
4. **Build settings:**
   - Build command: *(leave blank)*
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
5. **Add environment variable:**
   - `CRICKET_API_KEY` = your key from [cricketdata.org](https://cricketdata.org)
6. Deploy!

---

## 🏏 Adding a Match (After Each IPL Game)

After each IPL match, add a CSV file in `data/matches/`:

### CSV format: `data/matches/match-N.csv`

```
# CSK vs MI — Match 10
# 2026-04-10
#
# id, name, ipl_team, fantasy_team, playing, mom, runs, 4s, 6s, wkts, dots, maidens, lbw_b_hw, catches, ro_direct, ro_indirect, stumpings
1, Ravi Bishnoi, RR, RK, 1, 1, 0, 0, 0, 3, 12, 0, 2, 1, 0, 0, 0
2, Rohit Sharma, MI, RK, 1, 0, 45, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0
```

**Then:** `git add data/ && git commit -m "Match 10" && git push`

Netlify auto-deploys in ~30 seconds. 🎉

---

## 📁 Project Structure

```
pavilion/
├── public/
│   └── index.html          ← Full frontend (single file)
├── data/
│   ├── config.json         ← League name + API key
│   ├── players-cache.json  ← All 120 players across 8 teams
│   └── matches/
│       ├── match-1.csv
│       └── match-2.csv     ← One file per IPL match
├── netlify/
│   └── functions/
│       └── api.js          ← All API endpoints + live score logic
├── server.js               ← Local dev server
└── package.json
```

---

## 🔴 Live Score Integration

The `🔴 Live` tab auto-fetches the current IPL match scorecard from **CricketData.org** and calculates live fantasy points for all your teams.

- **Updates every 2 minutes** during a match
- Automatically finds the live IPL match (no config needed)
- Maps player names to your fantasy teams
- Calculates batting, bowling & fielding points in real time

> **Note:** Live points use available API data. Dot balls require the full scorecard (available via `/match_scorecard` endpoint). Final official points come from the CSV files committed after each match.

---

## 🎯 Scoring Rules

| Category | Rule | Points |
|---|---|---|
| Playing | In XI | +5 |
| Batting | Each run | +1 |
| Batting | Each four | +1 |
| Batting | Each six | +2 |
| Batting | 30+ runs | +5 |
| Batting | 50+ runs | +10 |
| Batting | 100+ runs | +10 |
| Bowling | Each dot | +1 |
| Bowling | Each wicket | +20 |
| Bowling | 2+ wkts | +5 |
| Bowling | 3+ wkts | +10 |
| Bowling | 5+ wkts | +10 |
| Bowling | Maiden over | +20 |
| Bowling | LBW/Bowled/HW | +5 |
| Fielding | Catch | +5 |
| Fielding | Direct run-out | +10 |
| Fielding | Indirect run-out | +5 |
| Fielding | Stumping | +10 |
| Bonus | Man of the Match | +30 |

---

Built with ❤️ for fantasy cricket friends everywhere.
# PavilionFork
