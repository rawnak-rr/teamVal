import {
  buildEventMapOverview,
  buildTeamMapCompositions,
  extractTeamsFromMatches,
  extractVCTEvents,
  filterEventsByRegion,
  getAllMatchIds,
  getTeamMatchIds,
  REGIONS
} from './teamval-domain';
import {
  fetchEventsPage,
  fetchEventMatches,
  fetchMatchDetails,
  UpstreamRequestError
} from './vlrgg-client';

const EVENT_PAGES = 4;
const LOOKBACK_DAYS = 30;
const DATASET_TTL_MS = 30 * 60 * 1000;
const MATCH_DETAILS_CONCURRENCY = 4;

let datasetCache = {
  value: null,
  expiresAt: 0,
  promise: null
};

class TeamValServiceError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TeamValServiceError';
    this.status = status;
    this.code = code;
  }
}

function getWindowStartDate() {
  return new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isInWindow(date, windowStart) {
  return Boolean(date) && date >= windowStart;
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function loadDataset() {
  const eventsPages = [];
  for (let page = 1; page <= EVENT_PAGES; page += 1) {
    const events = await fetchEventsPage(page);
    if (events.length === 0) break;
    eventsPages.push(events);
  }

  const windowStart = getWindowStartDate();
  const vctEvents = extractVCTEvents(eventsPages);
  const eventMatchesMap = {};
  const relevantEvents = [];

  for (const event of vctEvents) {
    const matches = (await fetchEventMatches(event)).filter((match) => isInWindow(match.date, windowStart));
    if (matches.length === 0) continue;

    eventMatchesMap[event.id] = matches;
    relevantEvents.push(event);
  }

  const allMatches = Object.values(eventMatchesMap).flat();
  const matchDetails = await mapLimit(allMatches, MATCH_DETAILS_CONCURRENCY, async (match) =>
    fetchMatchDetails(match)
  );

  const matchDetailsMap = {};
  for (const detail of matchDetails) {
    if (detail?.match_id) {
      matchDetailsMap[detail.match_id] = detail;
    }
  }

  return {
    vctEvents: relevantEvents,
    eventMatchesMap,
    matchDetailsMap,
    windowStart,
    cachedAt: new Date().toISOString()
  };
}

async function getDataset() {
  const now = Date.now();

  if (datasetCache.value && datasetCache.expiresAt > now) {
    return datasetCache.value;
  }

  if (datasetCache.promise) {
    return datasetCache.promise;
  }

  datasetCache.promise = loadDataset()
    .then((value) => {
      datasetCache = {
        value,
        expiresAt: Date.now() + DATASET_TTL_MS,
        promise: null
      };
      return value;
    })
    .catch((error) => {
      datasetCache.promise = null;

      if (datasetCache.value) {
        console.error('[teamval] dataset refresh failed, serving stale cache:', error);
        return datasetCache.value;
      }

      if (error instanceof UpstreamRequestError) {
        throw new TeamValServiceError(
          `Bootstrap data is temporarily unavailable because VLR.gg failed with HTTP ${error.status}.`,
          {
            status: 503,
            code: 'UPSTREAM_UNAVAILABLE',
            cause: error
          }
        );
      }

      throw error;
    });

  return datasetCache.promise;
}

function getRegionSnapshot(vctEvents, eventMatchesMap, region) {
  const regionEvents = filterEventsByRegion(vctEvents, region);
  const eventIds = regionEvents.map((event) => event.id);
  const teams = extractTeamsFromMatches(eventMatchesMap, eventIds);

  return {
    eventIds,
    eventNames: regionEvents.map((event) => event.title.toLowerCase()),
    teams
  };
}

function getDetailsForMatchIds(matchDetailsMap, matchIds) {
  return matchIds.map((matchId) => matchDetailsMap[matchId]).filter(Boolean);
}

function assertRequired(value, label) {
  if (!value) {
    throw new Error(`Missing required parameter: ${label}`);
  }
}

export async function getBootstrapPayload() {
  const { vctEvents, eventMatchesMap, windowStart, cachedAt } = await getDataset();
  const regionData = {};

  for (const region of REGIONS) {
    const snapshot = getRegionSnapshot(vctEvents, eventMatchesMap, region);
    regionData[region] = {
      teams: snapshot.teams,
      eventNames: snapshot.eventNames,
      teamCount: snapshot.teams.length,
      eventCount: snapshot.eventIds.length
    };
  }

  const totalMatches = Object.values(eventMatchesMap).reduce(
    (sum, matches) => sum + matches.length,
    0
  );

  return {
    regions: REGIONS,
    summary: {
      eventCount: vctEvents.length,
      matchCount: totalMatches,
      windowStart,
      cachedAt
    },
    regionData
  };
}

export async function getTeamAnalysis({ region, map, team }) {
  assertRequired(region, 'region');
  assertRequired(map, 'map');
  assertRequired(team, 'team');

  const { vctEvents, eventMatchesMap, matchDetailsMap } = await getDataset();
  const snapshot = getRegionSnapshot(vctEvents, eventMatchesMap, region);
  const matchIds = getTeamMatchIds(eventMatchesMap, team, snapshot.eventIds);

  if (matchIds.length === 0) {
    return {
      region,
      map,
      team,
      matchCount: 0,
      data: {
        compositions: [],
        maps: [],
        winRate: 0,
        wins: 0,
        losses: 0,
        totalGames: 0
      }
    };
  }

  const details = getDetailsForMatchIds(matchDetailsMap, matchIds);
  const data = buildTeamMapCompositions(details, team, map);

  return {
    region,
    map,
    team,
    matchCount: matchIds.length,
    data
  };
}

export async function getBrowseOverview({ region, map }) {
  assertRequired(region, 'region');
  assertRequired(map, 'map');

  const { vctEvents, eventMatchesMap, matchDetailsMap } = await getDataset();
  const snapshot = getRegionSnapshot(vctEvents, eventMatchesMap, region);
  const matchIds = getAllMatchIds(eventMatchesMap, snapshot.eventIds);
  const details = getDetailsForMatchIds(matchDetailsMap, matchIds);
  const overview = buildEventMapOverview(details, snapshot.teams, map);

  return {
    region,
    map,
    overview
  };
}

export { TeamValServiceError };
