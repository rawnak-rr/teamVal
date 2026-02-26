const App = (() => {
  const MAPS = ['Bind', 'Haven', 'Split', 'Ascent', 'Icebox', 'Breeze', 'Fracture', 'Pearl', 'Lotus', 'Sunset', 'Abyss'];
  const EVENT_PAGES = 7;

  // State
  let state = {
    vctEvents: [],           // discovered VCT events [{id, title, region, ...}]
    eventMatchesMap: {},      // eventId → array of match stubs
    selectedRegion: '',
    selectedMap: '',
    selectedTeam: '',
    regionEvents: [],        // events filtered to current region
    regionTeams: [],         // teams in current region
    dataLoaded: false
  };

  let els = {};

  function init() {
    els = {
      mapSelect: document.getElementById('map-select'),
      regionSelect: document.getElementById('region-select'),
      teamSelect: document.getElementById('team-select'),
      searchBtn: document.getElementById('search-btn'),
      browseBtn: document.getElementById('browse-btn'),
      log: document.getElementById('log'),
      results: document.getElementById('results'),
      teamWrapper: document.getElementById('team-select-wrapper')
    };

    populateMapSelect();
    populateRegionSelect();

    els.mapSelect.addEventListener('change', onMapChange);
    els.regionSelect.addEventListener('change', onRegionChange);
    els.teamSelect.addEventListener('change', () => { state.selectedTeam = els.teamSelect.value; });
    els.searchBtn.addEventListener('click', onSearch);
    els.browseBtn.addEventListener('click', onBrowse);

    log('initializing — discovering vct events');
    loadInitialData();
  }

  // --- Initial data load ---

  async function loadInitialData() {
    try {
      log('probing api connectivity', 'loading');
      await API.probeStrategy();
      logReplace('api connected', 'success');

      // Step 1: Fetch completed events pages 1-7
      log('fetching completed events (pages 1-7)', 'loading');
      const eventsPages = [];
      for (let p = 1; p <= EVENT_PAGES; p++) {
        const page = await API.fetchCompletedEventsPage(p);
        eventsPages.push(page);
        logReplace(`fetching events... page ${p}/${EVENT_PAGES}`, 'loading');
      }
      logReplace(`fetched ${EVENT_PAGES} event pages`, 'success');

      // Step 2: Filter to VCT events
      state.vctEvents = Aggregator.extractVCTEvents(eventsPages);
      console.log('[teamval] discovered VCT events:', state.vctEvents);

      if (state.vctEvents.length === 0) {
        log('no vct events found — check console', 'error');
        return;
      }

      log(`discovered ${state.vctEvents.length} vct events`, 'success');

      // Step 3: Fetch match lists for each VCT event
      log(`fetching match lists for ${state.vctEvents.length} events`, 'loading');
      for (let i = 0; i < state.vctEvents.length; i++) {
        const ev = state.vctEvents[i];
        const matches = await API.fetchEventMatches(ev.id);
        state.eventMatchesMap[ev.id] = matches;
        logReplace(`fetching event matches... ${i + 1}/${state.vctEvents.length}`, 'loading');
      }

      const totalMatches = Object.values(state.eventMatchesMap)
        .reduce((sum, arr) => sum + arr.length, 0);
      logReplace(`loaded ${totalMatches} matches across ${state.vctEvents.length} events`, 'success');

      state.dataLoaded = true;

      // Log discovered events to console
      for (const ev of state.vctEvents) {
        const matchCount = (state.eventMatchesMap[ev.id] || []).length;
        console.log(`[teamval]   ${ev.region}: ${ev.title} (${matchCount} matches) [id=${ev.id}]`);
      }

      log('select a region to begin');
    } catch (err) {
      console.error('[teamval] loadInitialData error:', err);
      logReplace(`error: ${err.message}`, 'error');
    }
  }

  // --- Populate dropdowns ---

  function populateMapSelect() {
    els.mapSelect.innerHTML = '<option value="">select map</option>';
    for (const m of MAPS) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m.toLowerCase();
      els.mapSelect.appendChild(opt);
    }
  }

  function populateRegionSelect() {
    els.regionSelect.innerHTML = '<option value="">select region</option>';
    const labels = {
      americas: 'americas',
      emea: 'emea',
      pacific: 'pacific',
      china: 'china',
      international: 'international'
    };
    for (const r of Aggregator.REGIONS) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = labels[r];
      els.regionSelect.appendChild(opt);
    }
  }

  function populateTeamSelect(teams) {
    els.teamSelect.innerHTML = '<option value="">select team</option>';
    for (const t of teams) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.toLowerCase();
      els.teamSelect.appendChild(opt);
    }
    els.teamWrapper.classList.remove('hidden');
  }

  // --- Event handlers ---

  function onMapChange() {
    state.selectedMap = els.mapSelect.value;
    clearResults();
  }

  function onRegionChange() {
    state.selectedRegion = els.regionSelect.value;
    state.selectedTeam = '';
    clearResults();

    if (!state.dataLoaded) {
      log('data still loading, please wait', 'error');
      return;
    }

    if (state.selectedRegion) {
      // Filter events to region
      state.regionEvents = Aggregator.filterEventsByRegion(state.vctEvents, state.selectedRegion);
      const eventIds = state.regionEvents.map(ev => ev.id);

      // Extract teams from those events' matches
      state.regionTeams = Aggregator.extractTeamsFromMatches(state.eventMatchesMap, eventIds);
      populateTeamSelect(state.regionTeams);

      clearLog();
      const eventNames = state.regionEvents.map(ev => ev.title.toLowerCase());
      log(`${state.selectedRegion} — ${state.regionTeams.length} teams across ${state.regionEvents.length} events`);
      for (const name of eventNames) {
        log(`  ${name}`);
      }
    } else {
      els.teamWrapper.classList.add('hidden');
    }
  }

  async function onSearch() {
    if (!state.selectedMap) {
      log('please select a map first', 'error');
      return;
    }
    if (!state.selectedRegion) {
      log('please select a region first', 'error');
      return;
    }
    if (!state.selectedTeam) {
      log('please select a team first', 'error');
      return;
    }

    clearResults();
    await loadTeamAnalysis();
  }

  async function onBrowse() {
    if (!state.selectedMap) {
      log('please select a map first', 'error');
      return;
    }
    if (!state.selectedRegion) {
      log('please select a region first', 'error');
      return;
    }
    clearResults();
    await loadBrowseAll();
  }

  // --- Data loading ---

  async function loadTeamAnalysis() {
    const team = state.selectedTeam;
    const map = state.selectedMap;
    const region = state.selectedRegion;

    clearLog();
    log(`analyzing ${team.toLowerCase()} on ${map.toLowerCase()} (${region})`, 'loading');

    try {
      // Find all match IDs for this team across ALL events (6 months)
      const matchIds = Aggregator.getTeamMatchIds(state.eventMatchesMap, team);

      if (matchIds.length === 0) {
        logReplace(`no matches found for ${team.toLowerCase()}`, 'error');
        return;
      }

      log(`found ${matchIds.length} matches, fetching details`, 'loading');

      const details = [];
      for (let i = 0; i < matchIds.length; i++) {
        const d = await API.fetchMatchDetails(matchIds[i]);
        if (d) details.push(d);
        if ((i + 1) % 3 === 0 || i === matchIds.length - 1) {
          logReplace(`fetching match details... ${i + 1}/${matchIds.length}`, 'loading');
        }
      }

      logReplace(`fetched ${details.length} match details`, 'success');

      const data = Aggregator.buildTeamMapData(details, team, map);

      if (data.totalGames === 0) {
        log(`no games on ${map.toLowerCase()} found for ${team.toLowerCase()}`, 'error');
        return;
      }

      log(`found ${data.totalGames} games on ${map.toLowerCase()}`, 'success');
      renderTeamResults(team, map, data);
    } catch (err) {
      logReplace(`error: ${err.message}`, 'error');
    }
  }

  async function loadBrowseAll() {
    const map = state.selectedMap;
    const region = state.selectedRegion;

    clearLog();
    log(`loading all ${region} teams on ${map.toLowerCase()}`, 'loading');

    try {
      const eventIds = state.regionEvents.map(ev => ev.id);
      const allIds = Aggregator.getAllMatchIds(state.eventMatchesMap, eventIds);

      log(`fetching details for ${allIds.length} matches`, 'loading');

      const details = [];
      for (let i = 0; i < allIds.length; i++) {
        const d = await API.fetchMatchDetails(allIds[i]);
        if (d) details.push(d);
        if ((i + 1) % 3 === 0 || i === allIds.length - 1) {
          logReplace(`fetching match details... ${i + 1}/${allIds.length}`, 'loading');
        }
      }

      logReplace(`fetched ${details.length} match details`, 'success');

      const overview = Aggregator.buildEventMapOverview(details, state.regionTeams, map);

      if (overview.length === 0) {
        log(`no data found for any team on ${map.toLowerCase()}`, 'error');
        return;
      }

      log(`found data for ${overview.length} teams`, 'success');
      renderBrowseAll(map, region, overview);
    } catch (err) {
      logReplace(`error: ${err.message}`, 'error');
    }
  }

  // --- Rendering ---

  function renderTeamResults(team, map, data) {
    let html = '';

    html += '<div class="results-header">AGENT COMPOSITION</div>';
    html += '<div class="results-divider">' + '\u2500'.repeat(60) + '</div>';

    if (data.agents.length === 0) {
      html += '<div class="no-data">no agent data available</div>';
    } else {
      for (const agent of data.agents) {
        const pct = data.totalGames > 0 ? (agent.count / data.totalGames * 100) : 0;
        html += `
          <div class="agent-row">
            <span class="agent-name">${esc(agent.name)}</span>
            <div class="agent-bar-container">
              <div class="agent-bar" style="width: ${pct}%"></div>
            </div>
            <span class="agent-games">${agent.count}/${data.totalGames}</span>
            <span class="agent-pct">${Math.round(pct)}%</span>
          </div>`;
      }
    }

    html += '<div class="winrate-section">';
    html += '<div class="results-header">MAP WIN RATE</div>';
    html += '<div class="results-divider">' + '\u2500'.repeat(60) + '</div>';

    const wrPct = Math.round(data.winRate * 100);
    const wrClass = wrPct >= 60 ? 'good' : wrPct >= 45 ? 'mid' : 'bad';
    const wrLabel = wrPct >= 60 ? 'W' : wrPct >= 45 ? '~' : 'L';

    html += `
      <div class="winrate-row">
        <span class="winrate-map">${esc(map.toLowerCase())}</span>
        <div class="winrate-bar-container">
          <div class="winrate-bar ${wrClass}" style="width: ${wrPct}%"></div>
        </div>
        <span class="winrate-record">${data.wins}/${data.totalGames}</span>
        <span class="winrate-pct winrate-label ${wrClass}">${wrPct}%</span>
        <span class="winrate-label ${wrClass}">${wrLabel}</span>
      </div>`;
    html += '</div>';

    els.results.innerHTML = html;
    els.results.classList.remove('hidden');
  }

  function renderBrowseAll(map, region, overview) {
    let html = '';

    html += '<button class="back-btn" onclick="App.clearBrowse()">\u2190 back</button>';
    html += '<div class="browse-table">';
    html += `
      <div class="browse-header">
        <span>team</span>
        <span style="text-align:center">w</span>
        <span style="text-align:center">l</span>
        <span style="text-align:center">win%</span>
        <span>top agents</span>
      </div>`;

    for (const row of overview) {
      const pct = Math.round(row.winRate * 100);
      const cls = pct >= 60 ? 'good' : pct >= 45 ? 'mid' : 'bad';
      const teamEsc = row.team.replace(/'/g, "\\'");
      html += `
        <div class="browse-row" onclick="App.selectTeamFromBrowse('${teamEsc}')">
          <span class="browse-team">${esc(row.team)}</span>
          <span class="browse-w">${row.wins}</span>
          <span class="browse-l">${row.losses}</span>
          <span class="browse-winpct winrate-label ${cls}">${pct}%</span>
          <span class="browse-agents">${esc(row.topAgents.join(', '))}</span>
        </div>`;
    }

    html += '</div>';
    els.results.innerHTML = html;
    els.results.classList.remove('hidden');
  }

  // --- Logging ---

  function log(msg, type) {
    const line = document.createElement('div');
    line.className = 'log-line' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    const dots = type === 'loading' ? '<span class="loading-dots"></span>' : '';
    line.innerHTML = `<span class="p">&gt;</span> ${esc(msg)}${dots}`;
    els.log.appendChild(line);
    els.log.scrollTop = els.log.scrollHeight;
    return line;
  }

  function logReplace(msg, type) {
    const last = els.log.lastElementChild;
    if (last) last.remove();
    log(msg, type);
  }

  function clearLog() {
    els.log.innerHTML = '';
  }

  function clearResults() {
    els.results.innerHTML = '';
    els.results.classList.add('hidden');
  }

  // --- Public ---

  function clearBrowse() {
    clearResults();
    clearLog();
    log('select a map, region, and team to analyze');
  }

  function selectTeamFromBrowse(teamName) {
    els.teamSelect.value = teamName;
    state.selectedTeam = teamName;
    clearResults();
    loadTeamAnalysis();
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  document.addEventListener('DOMContentLoaded', init);

  return { clearBrowse, selectTeamFromBrowse };
})();
