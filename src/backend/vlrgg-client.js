import * as cheerio from 'cheerio';

const ORIGIN = 'https://www.vlr.gg';
const REQUEST_DELAY_MS = 150;

let queue = Promise.resolve();

export class UpstreamRequestError extends Error {
  constructor(message, { status, path, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UpstreamRequestError';
    this.status = status || 500;
    this.path = path || '';
  }
}

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function enqueue(task) {
  queue = queue.then(
    () => new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS)).then(task)
  );
  return queue;
}

function buildUrl(path) {
  if (!path) return ORIGIN;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${ORIGIN}${path}`;
}

async function fetchHTML(path) {
  const response = await enqueue(() =>
    fetch(buildUrl(path), {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'teamval/0.1'
      },
      next: {
        revalidate: 1800
      }
    })
  );

  if (!response.ok) {
    throw new UpstreamRequestError(
      `Upstream request failed with HTTP ${response.status} for ${path}`,
      { status: response.status, path }
    );
  }

  return response.text();
}

function parseDateHeading(label) {
  const value = cleanText(label).replace(/,$/, '');
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

function parseEventDates(value) {
  const text = cleanText(value);
  if (!text) return { startDate: null, endDate: null };

  const year = new Date().getUTCFullYear();
  const parts = text.split('—').map((part) => cleanText(part));
  const start = parts[0] ? new Date(`${parts[0]}, ${year}`) : null;
  const endPart = parts[1] || parts[0] || '';
  const end = endPart && endPart !== 'TBD' ? new Date(`${endPart}, ${year}`) : start;

  return {
    startDate: start && !Number.isNaN(start.getTime()) ? start.toISOString().slice(0, 10) : null,
    endDate: end && !Number.isNaN(end.getTime()) ? end.toISOString().slice(0, 10) : null
  };
}

function parseEventsPage(html) {
  const $ = cheerio.load(html);

  return $('.event-item')
    .map((_, element) => {
      const item = $(element);
      const url = item.attr('href') || '';
      const title = cleanText(item.find('.event-item-title').text());
      const status = cleanText(item.find('.event-item-desc-item-status').text()).toLowerCase();
      const dates = cleanText(item.find('.event-item-desc-item.mod-dates').clone().find('.event-item-desc-item-label').remove().end().text());
      const { startDate, endDate } = parseEventDates(dates);

      return {
        id: extractEventId(url),
        title,
        url,
        status,
        dates,
        startDate,
        endDate
      };
    })
    .get()
    .filter((event) => event.id && event.title);
}

function parseEventMatchesPage(html, event) {
  const $ = cheerio.load(html);
  const matches = [];

  $('.wf-label.mod-large').each((_, labelElement) => {
    const date = parseDateHeading($(labelElement).text());
    const card = $(labelElement).next('.wf-card');
    if (!date || !card.length) return;

    card.find('a.match-item').each((__, matchElement) => {
      const match = $(matchElement);
      const url = match.attr('href') || '';
      const teams = match
        .find('.match-item-vs-team-name .text-of')
        .map((___, teamElement) => cleanText($(teamElement).text()))
        .get()
        .filter(Boolean);

      const status = cleanText(match.find('.ml-status').text()).toLowerCase();
      if (status && status !== 'completed') return;

      matches.push({
        match_id: extractMatchId(url),
        url,
        date,
        eventTitle: event.title,
        eventId: event.id,
        region: event.region,
        series: cleanText(match.find('.match-item-event-series').text()),
        team1: teams[0] ? { name: teams[0] } : null,
        team2: teams[1] ? { name: teams[1] } : null
      });
    });
  });

  return matches.filter((match) => match.match_id && match.team1?.name && match.team2?.name);
}

function parsePlayers(rows) {
  return rows
    .map((row) => {
      const agent = cleanText(
        row.find('td.mod-agents img').attr('title') || row.find('td.mod-agents img').attr('alt')
      );

      return {
        name: cleanText(row.find('td.mod-player .text-of').first().text()),
        tag: cleanText(row.find('td.mod-player .ge-text-light').text()),
        agent
      };
    })
    .filter((player) => player.agent);
}

function parseMapName(mapNode) {
  const heading = mapNode.find('.map > div').first().clone();
  heading.find('.picked').remove();
  return cleanText(heading.text());
}

function parseMatchDetailsPage(html, match) {
  const $ = cheerio.load(html);
  const maps = [];

  $('.vm-stats-game').each((_, gameElement) => {
    const game = $(gameElement);
    const headerTeams = game.find('.vm-stats-game-header > .team');
    if (headerTeams.length < 2) return;

    const team1Name = cleanText($(headerTeams[0]).find('.team-name').first().text());
    const team2Name = cleanText($(headerTeams[1]).find('.team-name').first().text());
    const team1Score = parseInt(cleanText($(headerTeams[0]).find('.score').first().text()), 10);
    const team2Score = parseInt(cleanText($(headerTeams[1]).find('.score').first().text()), 10);
    const mapName = parseMapName(game.find('.vm-stats-game-header'));
    if (!team1Name || !team2Name || !mapName) return;

    const playerRows = game
      .find('table.wf-table-inset.mod-overview tbody tr')
      .filter((__, rowElement) => $(rowElement).find('td.mod-player').length > 0)
      .toArray()
      .map((rowElement) => $(rowElement));

    const team1Players = parsePlayers(playerRows.slice(0, 5));
    const team2Players = parsePlayers(playerRows.slice(5, 10));

    maps.push({
      map_name: mapName,
      score: {
        team1: Number.isNaN(team1Score) ? 0 : team1Score,
        team2: Number.isNaN(team2Score) ? 0 : team2Score
      },
      players: {
        team1: team1Players,
        team2: team2Players
      }
    });
  });

  return {
    match_id: match.match_id,
    url: buildUrl(match.url),
    date: match.date,
    eventTitle: match.eventTitle,
    region: match.region,
    teams: match.team1 && match.team2 ? [{ name: match.team1.name }, { name: match.team2.name }] : [],
    maps
  };
}

export async function fetchEventsPage(page) {
  const suffix = page > 1 ? `/events/?page=${page}` : '/events';
  return parseEventsPage(await fetchHTML(suffix));
}

export async function fetchEventMatches(event) {
  return parseEventMatchesPage(
    await fetchHTML(`/event/matches/${event.id}/${event.url.split('/').filter(Boolean).pop()}/?series_id=all&group=completed`),
    event
  );
}

export async function fetchMatchDetails(match) {
  return parseMatchDetailsPage(await fetchHTML(match.url), match);
}

export function extractEventId(url) {
  if (!url) return null;
  const match = url.match(/\/event\/(\d+)/);
  return match ? match[1] : null;
}

export function extractMatchId(url) {
  if (!url) return null;
  const match = url.match(/\/(\d+)\//);
  return match ? match[1] : null;
}
