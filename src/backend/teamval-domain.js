import { extractEventId, extractMatchId } from './vlrgg-client';

export const REGIONS = ['americas', 'emea', 'pacific', 'china', 'international'];

const VCT_KEYWORDS = ['VCT', 'Champions', 'Masters'];
const VCT_EXCLUDE = ['Ascension', 'Game Changers', 'Challengers'];

const REGION_KEYWORDS = {
  americas: ['Americas'],
  emea: ['EMEA'],
  pacific: ['Pacific'],
  china: ['China'],
  international: ['Champions', 'Masters']
};

export function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

export function teamMatches(a, b) {
  return normalizeName(a) === normalizeName(b);
}

export function isVCT(title) {
  if (!title) return false;
  if (VCT_EXCLUDE.some((keyword) => title.includes(keyword))) return false;
  return VCT_KEYWORDS.some((keyword) => title.includes(keyword));
}

export function getRegion(title) {
  if (!title) return null;

  for (const keyword of REGION_KEYWORDS.international) {
    if (title.includes(keyword)) return 'international';
  }

  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (region === 'international') continue;
    for (const keyword of keywords) {
      if (title.includes(keyword)) return region;
    }
  }

  return null;
}

export function extractVCTEvents(eventsPages) {
  const events = [];
  const seen = new Set();

  for (const page of eventsPages) {
    for (const event of page) {
      const title = event.title || event.name || '';
      if (!isVCT(title)) continue;

      const id = extractEventId(event.url_path || event.url) || event.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);

      events.push({
        id,
        title,
        region: getRegion(title),
        url: event.url_path || event.url || '',
        dates: event.dates || '',
        status: event.status || ''
      });
    }
  }

  return events;
}

export function filterEventsByRegion(events, region) {
  if (!region) return events;
  return events.filter((event) => event.region === region || event.region === 'international');
}

export function extractTeamsFromMatches(eventMatchesMap, eventIds) {
  const teams = new Set();
  const ids = eventIds || Object.keys(eventMatchesMap);

  for (const eventId of ids) {
    const matches = eventMatchesMap[eventId] || [];
    for (const match of matches) {
      const team1 = match.team1?.name || match.team1;
      const team2 = match.team2?.name || match.team2;
      if (team1 && typeof team1 === 'string') teams.add(team1);
      if (team2 && typeof team2 === 'string') teams.add(team2);
    }
  }

  return [...teams].sort();
}

export function getTeamMatchIds(eventMatchesMap, teamName, eventIds) {
  const ids = new Set();
  const targetEventIds = eventIds || Object.keys(eventMatchesMap);

  for (const eventId of targetEventIds) {
    const matches = eventMatchesMap[eventId] || [];
    for (const match of matches) {
      const team1 = match.team1?.name || match.team1 || '';
      const team2 = match.team2?.name || match.team2 || '';
      if (teamMatches(team1, teamName) || teamMatches(team2, teamName)) {
        const matchId = match.match_id || extractMatchId(match.url);
        if (matchId) ids.add(matchId);
      }
    }
  }

  return [...ids];
}

export function getAllMatchIds(eventMatchesMap, eventIds) {
  const ids = new Set();
  const targetEventIds = eventIds || Object.keys(eventMatchesMap);

  for (const eventId of targetEventIds) {
    const matches = eventMatchesMap[eventId] || [];
    for (const match of matches) {
      const matchId = match.match_id || extractMatchId(match.url);
      if (matchId) ids.add(matchId);
    }
  }

  return [...ids];
}

function findTeamIndex(detail, teamName) {
  if (!detail?.teams) return -1;

  for (let index = 0; index < detail.teams.length; index += 1) {
    if (
      teamMatches(detail.teams[index].name, teamName) ||
      teamMatches(detail.teams[index].tag, teamName)
    ) {
      return index;
    }
  }

  return -1;
}

export function buildTeamMapData(matchDetails, teamName, mapName) {
  const agentCounts = {};
  let wins = 0;
  let losses = 0;
  let totalGames = 0;

  for (const detail of matchDetails) {
    const teamIndex = findTeamIndex(detail, teamName);
    if (teamIndex === -1) continue;

    const teamKey = teamIndex === 0 ? 'team1' : 'team2';
    const oppKey = teamIndex === 0 ? 'team2' : 'team1';

    for (const map of detail.maps || []) {
      if (!map.map_name) continue;
      if (normalizeName(map.map_name) !== normalizeName(mapName)) continue;

      totalGames += 1;

      const teamScore = parseInt(map.score?.[teamKey], 10) || 0;
      const oppScore = parseInt(map.score?.[oppKey], 10) || 0;
      if (teamScore > oppScore) wins += 1;
      else losses += 1;

      const players = map.players?.[teamKey] || [];
      for (const player of players) {
        if (!player.agent) continue;
        const agent = player.agent;
        if (!agentCounts[agent]) agentCounts[agent] = 0;
        agentCounts[agent] += 1;
      }
    }
  }

  const agents = Object.entries(agentCounts)
    .map(([name, count]) => ({ name, count, games: totalGames }))
    .sort((a, b) => b.count - a.count);

  const winRate = totalGames > 0 ? wins / totalGames : 0;
  return { agents, winRate, wins, losses, totalGames };
}

export function buildEventMapOverview(matchDetails, teams, mapName) {
  const overview = [];

  for (const teamName of teams) {
    const data = buildTeamMapData(matchDetails, teamName, mapName);
    if (data.totalGames === 0) continue;

    overview.push({
      team: teamName,
      wins: data.wins,
      losses: data.losses,
      winRate: data.winRate,
      gamesPlayed: data.totalGames,
      topAgents: data.agents.slice(0, 3).map((agent) => agent.name)
    });
  }

  overview.sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.gamesPlayed - a.gamesPlayed;
  });

  return overview;
}
