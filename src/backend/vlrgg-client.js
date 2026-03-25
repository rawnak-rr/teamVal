const API_ORIGIN = 'https://vlrggapi.vercel.app';
const REQUEST_DELAY_MS = 300;

let queue = Promise.resolve();

function enqueue(task) {
  queue = queue.then(
    () => new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS)).then(task)
  );
  return queue;
}

async function fetchJSON(path) {
  const response = await enqueue(() =>
    fetch(`${API_ORIGIN}${path}`, {
      headers: {
        Accept: 'application/json'
      },
      next: {
        revalidate: 1800
      }
    })
  );

  if (!response.ok) {
    throw new Error(`Upstream request failed with HTTP ${response.status} for ${path}`);
  }

  const json = await response.json();
  if (json?.error) {
    throw new Error(`Upstream proxy error: ${json.error}`);
  }

  return json;
}

export async function fetchCompletedEventsPage(page) {
  const data = await fetchJSON(`/v2/events?q=completed&page=${page}`);
  return data?.data?.segments || [];
}

export async function fetchEventMatches(eventId) {
  const data = await fetchJSON(`/v2/events/matches?event_id=${eventId}`);
  return data?.data?.segments || [];
}

export async function fetchMatchDetails(matchId) {
  const data = await fetchJSON(`/v2/match/details?match_id=${matchId}`);
  return data?.data?.segments?.[0] || null;
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
