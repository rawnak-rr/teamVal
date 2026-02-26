const API = (() => {
  const API_ORIGIN = 'https://vlrggapi.vercel.app';
  const CACHE_PREFIX = 'teamval_';
  const TTL_EVENT = 7 * 24 * 60 * 60 * 1000;   // 7 days for event/match list data
  const TTL_DETAIL = 30 * 24 * 60 * 60 * 1000;  // 30 days for match details

  // Proxy strategies
  const STRATEGIES = [
    { name: 'direct',     url: (path) => API_ORIGIN + path },
    { name: 'corsproxy',  url: (path) => 'https://corsproxy.io/?' + encodeURIComponent(API_ORIGIN + path) },
    { name: 'allorigins', url: (path) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(API_ORIGIN + path) },
  ];

  let resolvedStrategy = null;

  // Rate-limit queue
  let queue = Promise.resolve();
  const DELAY = 300;

  function enqueue(fn) {
    queue = queue.then(() => new Promise(r => setTimeout(r, DELAY))).then(fn);
    return queue;
  }

  // --- localStorage cache with TTL ---

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const { data, ts, ttl } = JSON.parse(raw);
      if (Date.now() - ts > (ttl || TTL_EVENT)) {
        localStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return data;
    } catch { return null; }
  }

  function cacheSet(key, data, ttl) {
    try {
      localStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ data, ts: Date.now(), ttl: ttl || TTL_EVENT })
      );
    } catch {
      // Quota exceeded — evict oldest entries
      evictOldest(10);
      try {
        localStorage.setItem(
          CACHE_PREFIX + key,
          JSON.stringify({ data, ts: Date.now(), ttl: ttl || TTL_EVENT })
        );
      } catch { /* give up */ }
    }
  }

  function evictOldest(count) {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k.startsWith(CACHE_PREFIX)) continue;
      try {
        const { ts } = JSON.parse(localStorage.getItem(k));
        entries.push({ key: k, ts });
      } catch {
        entries.push({ key: k, ts: 0 });
      }
    }
    entries.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      localStorage.removeItem(entries[i].key);
    }
  }

  function clearCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  }

  // --- Strategy probing ---

  async function testStrategy(strategy) {
    const testUrl = strategy.url('/v2/events?q=completed&page=1');
    const resp = await fetch(testUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return false;
    const json = await resp.json();
    if (json?.data?.segments && Array.isArray(json.data.segments) && json.data.segments.length > 0) {
      return true;
    }
    return false;
  }

  async function probeStrategy() {
    if (resolvedStrategy !== null) return resolvedStrategy;

    for (const strategy of STRATEGIES) {
      try {
        console.log('[teamval] probing strategy:', strategy.name);
        const works = await testStrategy(strategy);
        if (works) {
          resolvedStrategy = strategy;
          console.log('[teamval] using strategy:', strategy.name);
          return resolvedStrategy;
        }
        console.log('[teamval] strategy failed validation:', strategy.name);
      } catch (err) {
        console.log('[teamval] strategy error:', strategy.name, err.message);
      }
    }
    throw new Error('All API endpoints unreachable. Try a different browser or disable extensions.');
  }

  // --- Core fetch ---

  async function fetchJSON(path) {
    const strategy = await probeStrategy();
    const url = strategy.url(path);
    console.log('[teamval] fetch:', url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${path}`);
    const json = await resp.json();
    if (json.error) {
      throw new Error(`Proxy error: ${json.error}`);
    }
    return json;
  }

  // --- New event-driven endpoints ---

  /**
   * Fetch a page of completed events.
   * Returns array of event objects from /v2/events?q=completed&page=N
   */
  async function fetchCompletedEventsPage(page) {
    const key = `events_page_${page}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const data = await enqueue(() =>
      fetchJSON(`/v2/events?q=completed&page=${page}`)
    );
    const segments = data?.data?.segments || [];
    cacheSet(key, segments, TTL_EVENT);
    return segments;
  }

  /**
   * Fetch all matches for a specific event.
   * Returns array of match objects from /v2/events/matches?event_id=N
   */
  async function fetchEventMatches(eventId) {
    const key = `event_matches_${eventId}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const data = await enqueue(() =>
      fetchJSON(`/v2/events/matches?event_id=${eventId}`)
    );
    const segments = data?.data?.segments || [];
    cacheSet(key, segments, TTL_EVENT);
    return segments;
  }

  /**
   * Fetch detailed match data for a single match.
   */
  async function fetchMatchDetails(matchId) {
    const key = `details_${matchId}`;
    const cached = cacheGet(key);
    if (cached) return cached;

    const data = await enqueue(() =>
      fetchJSON(`/v2/match/details?match_id=${matchId}`)
    );

    const detail = data?.data?.segments?.[0] || null;
    if (detail) cacheSet(key, detail, TTL_DETAIL);
    return detail;
  }

  /**
   * Extract event ID from a vlr.gg event URL.
   * e.g. "https://www.vlr.gg/event/2682/..." → "2682"
   */
  function extractEventId(url) {
    if (!url) return null;
    const match = url.match(/\/event\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Extract match ID from a vlr.gg match URL.
   * e.g. "https://www.vlr.gg/596399/..." → "596399"
   */
  function extractMatchId(url) {
    if (!url) return null;
    const match = url.match(/\/(\d+)\//);
    return match ? match[1] : null;
  }

  return {
    fetchCompletedEventsPage,
    fetchEventMatches,
    fetchMatchDetails,
    extractEventId,
    extractMatchId,
    clearCache,
    probeStrategy
  };
})();
