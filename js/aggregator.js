const Aggregator = (() => {

  // VCT event title keywords for filtering
  const VCT_KEYWORDS = ['VCT', 'Champions', 'Masters'];
  // Exclude non-tier-1 VCT events
  const VCT_EXCLUDE = ['Ascension', 'Game Changers', 'Challengers'];

  // Region mapping: keywords in event title → region
  const REGION_KEYWORDS = {
    americas: ['Americas'],
    emea: ['EMEA'],
    pacific: ['Pacific'],
    china: ['China'],
    international: ['Champions', 'Masters']
  };

  const REGIONS = ['americas', 'emea', 'pacific', 'china', 'international'];

  /**
   * Check if an event title is a VCT-tier event.
   */
  function isVCT(title) {
    if (!title) return false;
    if (VCT_EXCLUDE.some(kw => title.includes(kw))) return false;
    return VCT_KEYWORDS.some(kw => title.includes(kw));
  }

  /**
   * Determine region from an event title.
   * Returns region string or null if not identifiable.
   */
  function getRegion(title) {
    if (!title) return null;
    // Check international first (Champions/Masters)
    for (const kw of REGION_KEYWORDS.international) {
      if (title.includes(kw)) return 'international';
    }
    for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
      if (region === 'international') continue;
      for (const kw of keywords) {
        if (title.includes(kw)) return region;
      }
    }
    return null;
  }

  /**
   * Extract VCT events from multiple pages of completed events.
   * Input: array of arrays (each page's segments)
   * Returns: array of { id, title, region, url, dates, status }
   */
  function extractVCTEvents(eventsPages) {
    const events = [];
    const seen = new Set();

    for (const page of eventsPages) {
      for (const ev of page) {
        const title = ev.title || ev.name || '';
        if (!isVCT(title)) continue;

        const id = API.extractEventId(ev.url_path || ev.url) || ev.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const region = getRegion(title);

        events.push({
          id,
          title,
          region,
          url: ev.url_path || ev.url || '',
          dates: ev.dates || '',
          status: ev.status || ''
        });
      }
    }

    return events;
  }

  /**
   * Filter events to a specific region.
   * International events (Champions/Masters) are included for all regions.
   */
  function filterEventsByRegion(events, region) {
    if (!region) return events;
    return events.filter(ev =>
      ev.region === region || ev.region === 'international'
    );
  }

  /**
   * Extract unique team names from event match data.
   * Input: object mapping eventId → array of match stubs
   * Optional: filter to specific event IDs
   */
  function extractTeamsFromMatches(eventMatchesMap, eventIds) {
    const teams = new Set();
    const ids = eventIds || Object.keys(eventMatchesMap);

    for (const eid of ids) {
      const matches = eventMatchesMap[eid] || [];
      for (const m of matches) {
        const t1 = m.team1?.name || m.team1;
        const t2 = m.team2?.name || m.team2;
        if (t1 && typeof t1 === 'string') teams.add(t1);
        if (t2 && typeof t2 === 'string') teams.add(t2);
      }
    }

    return [...teams].sort();
  }

  /**
   * Get all match IDs for a specific team across given events.
   * Input: eventMatchesMap (eventId → matches[]), teamName
   * Optional: eventIds to limit search
   */
  function getTeamMatchIds(eventMatchesMap, teamName, eventIds) {
    const ids = new Set();
    const eids = eventIds || Object.keys(eventMatchesMap);

    for (const eid of eids) {
      const matches = eventMatchesMap[eid] || [];
      for (const m of matches) {
        const t1 = m.team1?.name || m.team1 || '';
        const t2 = m.team2?.name || m.team2 || '';
        if (teamMatches(t1, teamName) || teamMatches(t2, teamName)) {
          const matchId = m.match_id || API.extractMatchId(m.url);
          if (matchId) ids.add(matchId);
        }
      }
    }

    return [...ids];
  }

  /**
   * Get ALL match IDs for given events (no team filter).
   */
  function getAllMatchIds(eventMatchesMap, eventIds) {
    const ids = new Set();
    const eids = eventIds || Object.keys(eventMatchesMap);

    for (const eid of eids) {
      const matches = eventMatchesMap[eid] || [];
      for (const m of matches) {
        const matchId = m.match_id || API.extractMatchId(m.url);
        if (matchId) ids.add(matchId);
      }
    }

    return [...ids];
  }

  // --- Name matching utilities ---

  function normalizeName(name) {
    return (name || '').trim().toLowerCase();
  }

  function teamMatches(a, b) {
    return normalizeName(a) === normalizeName(b);
  }

  /**
   * Find which team index (0 or 1) in match detail corresponds to team name.
   */
  function findTeamIndex(detail, teamName) {
    if (!detail?.teams) return -1;
    for (let i = 0; i < detail.teams.length; i++) {
      if (teamMatches(detail.teams[i].name, teamName) ||
          teamMatches(detail.teams[i].tag, teamName)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Build per-map agent composition and win rate for a specific team.
   */
  function buildTeamMapData(matchDetails, teamName, mapName) {
    const agentCounts = {};
    let wins = 0;
    let losses = 0;
    let totalGames = 0;

    for (const detail of matchDetails) {
      const teamIdx = findTeamIndex(detail, teamName);
      if (teamIdx === -1) continue;

      const teamKey = teamIdx === 0 ? 'team1' : 'team2';
      const oppKey = teamIdx === 0 ? 'team2' : 'team1';

      for (const map of (detail.maps || [])) {
        if (!map.map_name) continue;
        if (normalizeName(map.map_name) !== normalizeName(mapName)) continue;

        totalGames++;

        const s1 = parseInt(map.score?.[teamKey]) || 0;
        const s2 = parseInt(map.score?.[oppKey]) || 0;
        if (s1 > s2) wins++; else losses++;

        const players = map.players?.[teamKey] || [];
        for (const player of players) {
          if (!player.agent) continue;
          const agent = player.agent;
          if (!agentCounts[agent]) agentCounts[agent] = 0;
          agentCounts[agent]++;
        }
      }
    }

    const agents = Object.entries(agentCounts)
      .map(([name, count]) => ({ name, count, games: totalGames }))
      .sort((a, b) => b.count - a.count);

    const winRate = totalGames > 0 ? wins / totalGames : 0;
    return { agents, winRate, wins, losses, totalGames };
  }

  /**
   * Build overview for all teams on a specific map.
   */
  function buildEventMapOverview(matchDetails, teams, mapName) {
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
        topAgents: data.agents.slice(0, 3).map(a => a.name)
      });
    }

    overview.sort((a, b) => {
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return b.gamesPlayed - a.gamesPlayed;
    });

    return overview;
  }

  return {
    REGIONS,
    isVCT,
    getRegion,
    extractVCTEvents,
    filterEventsByRegion,
    extractTeamsFromMatches,
    getTeamMatchIds,
    getAllMatchIds,
    buildTeamMapData,
    buildEventMapOverview,
    normalizeName,
    teamMatches
  };
})();
