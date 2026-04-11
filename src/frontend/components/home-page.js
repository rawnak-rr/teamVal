'use client';

import { useEffect, useState } from 'react';

const MAPS = ['Bind', 'Haven', 'Split', 'Ascent', 'Icebox', 'Breeze', 'Fracture', 'Pearl', 'Lotus', 'Sunset', 'Abyss'];

function classifyWinRate(winRate) {
  if (winRate >= 60) return 'good';
  if (winRate >= 45) return 'mid';
  return 'bad';
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchJSON(url) {
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return payload;
}

export function HomePage() {
  const [bootstrap, setBootstrap] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedMap, setSelectedMap] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [logs, setLogs] = useState([]);
  const [teamResult, setTeamResult] = useState(null);
  const [browseOverview, setBrowseOverview] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrap() {
      try {
        setLogs([{ message: 'Loading match data', type: 'loading' }]);

        const payload = await fetchJSON('/api/bootstrap');
        if (cancelled) return;

        setBootstrap(payload);
        setLogs([
          {
            message: `${payload.summary.matchCount} matches loaded from ${payload.summary.windowStart}`,
            type: 'success'
          }
        ]);
      } catch (error) {
        if (cancelled) return;
        console.error('[teamval] loadBootstrap error:', error);
        setLogs([
          {
            message:
              error.status === 503
                ? 'vlr.gg is not available right now'
                : error.message,
            type: 'error'
          }
        ]);
      }
    }

    loadBootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const regionSnapshot = bootstrap?.regionData?.[selectedRegion] || null;
  const regionTeams = regionSnapshot?.teams || [];
  const status = logs[0] || { message: 'Choose a region, map, and team', type: 'info' };
  const selectedMatch =
    teamResult?.data?.maps.find((entry) => entry.matchId === selectedMatchId) ||
    teamResult?.data?.maps?.[0] ||
    null;
  const winRate = teamResult ? Math.round(teamResult.data.winRate * 100) : 0;
  const winRateClass = classifyWinRate(winRate);

  function clearResults() {
    setTeamResult(null);
    setBrowseOverview(null);
    setSelectedMatchId('');
  }

  function onRegionChange(region) {
    setSelectedRegion(region);
    setSelectedTeam('');
    clearResults();

    if (!region) {
      setLogs([{ message: 'Choose a region to continue', type: 'info' }]);
      return;
    }

    if (!bootstrap) {
      setLogs([{ message: 'Match data is still loading', type: 'error' }]);
      return;
    }

    const snapshot = bootstrap.regionData[region];
    setLogs([{ message: `${snapshot.teamCount} teams available in ${region}`, type: 'success' }]);
  }

  function onMapChange(map) {
    setSelectedMap(map);
    clearResults();
    setLogs([{ message: map ? `${map} selected` : 'Choose a map to continue', type: 'info' }]);
  }

  function clearBrowse() {
    clearResults();
    setLogs([{ message: 'Choose a region, map, and team', type: 'info' }]);
  }

  async function onSearch(teamName = selectedTeam) {
    if (!selectedRegion) {
      setLogs([{ message: 'Choose a region first', type: 'error' }]);
      return;
    }
    if (!selectedMap) {
      setLogs([{ message: 'Choose a map first', type: 'error' }]);
      return;
    }
    if (!teamName) {
      setLogs([{ message: 'Choose a team first', type: 'error' }]);
      return;
    }

    clearResults();
    setLogs([{ message: `Checking ${teamName} on ${selectedMap}`, type: 'loading' }]);

    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        map: selectedMap,
        team: teamName
      });
      const payload = await fetchJSON(`/api/team-analysis?${params.toString()}`);

      if (payload.matchCount === 0) {
        setLogs([{ message: `No matches found for ${teamName}`, type: 'error' }]);
        return;
      }

      if (payload.data.totalGames === 0) {
        setLogs([{ message: `No ${selectedMap} maps found for ${teamName}`, type: 'error' }]);
        return;
      }

      setLogs([{ message: `${payload.data.totalGames} ${selectedMap} maps found`, type: 'success' }]);
      setSelectedTeam(teamName);
      setTeamResult(payload);
      setBrowseOverview(null);
      setSelectedMatchId(payload.data.maps[0]?.matchId || '');
    } catch (error) {
      setLogs([{ message: error.message, type: 'error' }]);
    }
  }

  async function onBrowse() {
    if (!selectedRegion) {
      setLogs([{ message: 'Choose a region first', type: 'error' }]);
      return;
    }
    if (!selectedMap) {
      setLogs([{ message: 'Choose a map first', type: 'error' }]);
      return;
    }

    clearResults();
    setLogs([{ message: `Loading ${selectedRegion} teams on ${selectedMap}`, type: 'loading' }]);

    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        map: selectedMap
      });
      const payload = await fetchJSON(`/api/browse-all?${params.toString()}`);

      if (payload.overview.length === 0) {
        setLogs([{ message: `No ${selectedMap} data found in ${selectedRegion}`, type: 'error' }]);
        return;
      }

      setLogs([{ message: `${payload.overview.length} teams found`, type: 'success' }]);
      setBrowseOverview(payload);
    } catch (error) {
      setLogs([{ message: error.message, type: 'error' }]);
    }
  }

  return (
    <main className="app-shell">
      <section className="query-panel" aria-label="Filters">
        <form
          className="query-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <label>
            <span>Region</span>
            <select
              aria-label="Select region"
              value={selectedRegion}
              onChange={(event) => onRegionChange(event.target.value)}
            >
              <option value="">Choose region</option>
              {(bootstrap?.regions || []).map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Map</span>
            <select
              aria-label="Select map"
              value={selectedMap}
              onChange={(event) => onMapChange(event.target.value)}
            >
              <option value="">Choose map</option>
              {MAPS.map((map) => (
                <option key={map} value={map}>
                  {map}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Team</span>
            <select
              aria-label="Select team"
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
              disabled={!selectedRegion}
            >
              <option value="">{selectedRegion ? 'Choose team' : 'Choose region first'}</option>
              {regionTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </label>

          <div className="actions">
            <button type="submit" className="primary-action">
              Analyze team
            </button>
            <button type="button" className="secondary-action" onClick={onBrowse}>
              Browse region
            </button>
          </div>

          <div className={`status-pill ${status.type}`}>
            <span />
            {status.message}
            {status.type === 'loading' ? <b className="loading-dots" /> : null}
          </div>
        </form>
      </section>

      <section className="workspace">
        {!teamResult && !browseOverview ? (
          <div className="empty-state">
            <p className="panel-label">Ready</p>
            <h1>Select filters to view data.</h1>
          </div>
        ) : null}

        {teamResult ? (
          <div className="results-layout" aria-label="Team result">
            <div className="score-panel">
              <div>
                <p className="panel-label">{titleCase(teamResult.team)} on {teamResult.map}</p>
                <h2>{winRate}%</h2>
                <p>{teamResult.data.wins} wins from {teamResult.data.totalGames} maps</p>
              </div>
              <div className="meter" aria-hidden="true">
                <div className={`meter-fill ${winRateClass}`} style={{ width: `${winRate}%` }} />
              </div>
            </div>

            <div className="match-panel">
              <div className="panel-heading">
                <div>
                  <p className="panel-label">Recent maps</p>
                  <h2>Match history</h2>
                </div>
                <span>{teamResult.data.maps.length} maps</span>
              </div>

              <div className="match-grid">
                <div className="match-list">
                  {teamResult.data.maps.map((entry) => (
                    <button
                      key={`${entry.matchId}-${entry.date}-${entry.opponent}`}
                      type="button"
                      className={`match-list-item${selectedMatch?.matchId === entry.matchId ? ' active' : ''}`}
                      onClick={() => setSelectedMatchId(entry.matchId)}
                    >
                      <span className="match-list-meta">
                        {entry.date} · {entry.eventTitle}
                      </span>
                      <span className="match-list-title">
                        {entry.team} vs {entry.opponent}
                      </span>
                      <span className={`match-list-score ${entry.won ? 'good' : 'bad'}`}>
                        {entry.score.team}-{entry.score.opponent} {entry.won ? 'W' : 'L'}
                      </span>
                    </button>
                  ))}
                </div>

                {selectedMatch ? (
                  <div className="match-detail">
                    <div className="match-detail-header">
                      <div>
                        <p className="panel-label">Selected map</p>
                        <h3>{selectedMatch.team} vs {selectedMatch.opponent}</h3>
                        <span>{selectedMatch.date} · {selectedMatch.eventTitle} · {teamResult.map}</span>
                      </div>
                      <strong className={selectedMatch.won ? 'good' : 'bad'}>
                        {selectedMatch.score.team}-{selectedMatch.score.opponent}
                      </strong>
                    </div>

                    <div className="lineup-grid">
                      <div className="lineup-card">
                        <h4>{selectedMatch.team}</h4>
                        <div className="lineup-list">
                          {selectedMatch.teamPlayers.map((player) => (
                            <div
                              key={`${selectedMatch.matchId}-team-${player.name}-${player.agent}`}
                              className="lineup-player"
                            >
                              <span>{player.name}</span>
                              <strong>{player.agent}</strong>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="lineup-card">
                        <h4>{selectedMatch.opponent}</h4>
                        <div className="lineup-list">
                          {selectedMatch.opponentPlayers.map((player) => (
                            <div
                              key={`${selectedMatch.matchId}-opp-${player.name}-${player.agent}`}
                              className="lineup-player"
                            >
                              <span>{player.name}</span>
                              <strong>{player.agent}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {browseOverview ? (
          <div className="browse-panel" aria-label="Region overview">
            <div className="panel-heading">
              <div>
                <p className="panel-label">{selectedRegion} · {selectedMap}</p>
                <h2>Team overview</h2>
              </div>
              <button type="button" className="secondary-action compact" onClick={clearBrowse}>
                Clear
              </button>
            </div>

            <div className="browse-table">
              <div className="browse-header">
                <span>Team</span>
                <span>W</span>
                <span>L</span>
                <span>Win</span>
                <span>Top comp</span>
              </div>

              {browseOverview.overview.map((row) => {
                const percentage = Math.round(row.winRate * 100);
                const rowClass = classifyWinRate(percentage);

                return (
                  <button
                    key={row.team}
                    type="button"
                    className="browse-row"
                    onClick={() => onSearch(row.team)}
                  >
                    <span className="browse-team">{row.team}</span>
                    <span>{row.wins}</span>
                    <span>{row.losses}</span>
                    <strong className={rowClass}>{percentage}%</strong>
                    <span className="browse-agents">{row.topComposition.join(', ') || 'No comp'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <footer className="footer">
        <a href="https://vlr.gg" target="_blank" rel="noopener noreferrer">
          vlr.gg data
        </a>
      </footer>
    </main>
  );
}
