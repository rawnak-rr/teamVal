import {
  buildEventMapOverview,
  buildTeamMapData,
  extractTeamsFromMatches,
  extractVCTEvents,
  filterEventsByRegion,
  getAllMatchIds,
  getTeamMatchIds,
  REGIONS
} from './teamval-domain';
import {
  fetchCompletedEventsPage,
  fetchEventMatches,
  fetchMatchDetails
} from './vlrgg-client';

const EVENT_PAGES = 7;
const DATASET_TTL_MS = 30 * 60 * 1000;

let datasetCache = {
  value: null,
  expiresAt: 0,
  promise: null
};

async function loadDataset() {
  const eventsPages = [];
  for (let page = 1; page <= EVENT_PAGES; page += 1) {
    eventsPages.push(await fetchCompletedEventsPage(page));
  }

  const vctEvents = extractVCTEvents(eventsPages);
  const eventMatchesMap = {};

  for (const event of vctEvents) {
    eventMatchesMap[event.id] = await fetchEventMatches(event.id);
  }

  return { vctEvents, eventMatchesMap };
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

async function fetchDetails(matchIds) {
  const details = [];

  for (const matchId of matchIds) {
    const detail = await fetchMatchDetails(matchId);
    if (detail) details.push(detail);
  }

  return details;
}

function assertRequired(value, label) {
  if (!value) {
    throw new Error(`Missing required parameter: ${label}`);
  }
}

export async function getBootstrapPayload() {
  const { vctEvents, eventMatchesMap } = await getDataset();
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
      matchCount: totalMatches
    },
    regionData
  };
}

export async function getTeamAnalysis({ region, map, team }) {
  assertRequired(region, 'region');
  assertRequired(map, 'map');
  assertRequired(team, 'team');

  const { vctEvents, eventMatchesMap } = await getDataset();
  const snapshot = getRegionSnapshot(vctEvents, eventMatchesMap, region);
  const matchIds = getTeamMatchIds(eventMatchesMap, team, snapshot.eventIds);

  if (matchIds.length === 0) {
    return {
      region,
      map,
      team,
      matchCount: 0,
      data: {
        agents: [],
        winRate: 0,
        wins: 0,
        losses: 0,
        totalGames: 0
      }
    };
  }

  const details = await fetchDetails(matchIds);
  const data = buildTeamMapData(details, team, map);

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

  const { vctEvents, eventMatchesMap } = await getDataset();
  const snapshot = getRegionSnapshot(vctEvents, eventMatchesMap, region);
  const matchIds = getAllMatchIds(eventMatchesMap, snapshot.eventIds);
  const details = await fetchDetails(matchIds);
  const overview = buildEventMapOverview(details, snapshot.teams, map);

  return {
    region,
    map,
    overview
  };
}
