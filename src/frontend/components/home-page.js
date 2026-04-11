'use client';

import { useEffect, useState } from 'react';

const MAPS = ['Bind', 'Haven', 'Split', 'Ascent', 'Icebox', 'Breeze', 'Fracture', 'Pearl', 'Lotus', 'Sunset', 'Abyss'];

function classifyWinRate(winRate) {
  if (winRate >= 60) return 'good';
  if (winRate >= 45) return 'mid';
  return 'bad';
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
        setLogs([
          { message: 'initializing - loading backend data', type: 'info' },
          { message: 'requesting bootstrap data', type: 'loading' }
        ]);

        const payload = await fetchJSON('/api/bootstrap');
        if (cancelled) return;

        setBootstrap(payload);
        setLogs([
          { message: 'backend connected', type: 'success' },
          {
            message: `loaded ${payload.summary.matchCount} matches across ${payload.summary.eventCount} events since ${payload.summary.windowStart}`,
            type: 'success'
          },
          { message: 'select a region to begin', type: 'info' }
        ]);
      } catch (error) {
        if (cancelled) return;
        console.error('[teamval] loadBootstrap error:', error);
        setLogs([
              {
                message:
                  error.status === 503
                    ? 'backend unavailable: vlr.gg scrape source rejected the request'
                    : `error: ${error.message}`,
                type: 'error'
              },
          ...(error.status === 503
            ? [{ message: 'retry after the upstream service is available again', type: 'info' }]
            : [])
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
      setLogs([{ message: 'select a region to begin', type: 'info' }]);
      return;
    }

    if (!bootstrap) {
      setLogs([{ message: 'backend data is still loading', type: 'error' }]);
      return;
    }

    const snapshot = bootstrap.regionData[region];
    setLogs([
      {
        message: `${region} - ${snapshot.teamCount} teams across ${snapshot.eventCount} events`,
        type: 'info'
      },
      ...snapshot.eventNames.map((name) => ({ message: `  ${name}`, type: 'info' }))
    ]);
  }

  function clearBrowse() {
    clearResults();
    setLogs([{ message: 'select a map, region, and team to analyze', type: 'info' }]);
  }

  async function onSearch(teamName = selectedTeam) {
    if (!selectedMap) {
      setLogs([{ message: 'please select a map first', type: 'error' }]);
      return;
    }
    if (!selectedRegion) {
      setLogs([{ message: 'please select a region first', type: 'error' }]);
      return;
    }
    if (!teamName) {
      setLogs([{ message: 'please select a team first', type: 'error' }]);
      return;
    }

    clearResults();
    setLogs([
      {
        message: `analyzing ${teamName.toLowerCase()} on ${selectedMap.toLowerCase()} (${selectedRegion})`,
        type: 'loading'
      }
    ]);

    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        map: selectedMap,
        team: teamName
      });
      const payload = await fetchJSON(`/api/team-analysis?${params.toString()}`);

      if (payload.matchCount === 0) {
        setLogs([{ message: `no matches found for ${teamName.toLowerCase()}`, type: 'error' }]);
        return;
      }

      if (payload.data.totalGames === 0) {
        setLogs([{ message: `no games on ${selectedMap.toLowerCase()} found for ${teamName.toLowerCase()}`, type: 'error' }]);
        return;
      }

      setLogs([
        { message: `found ${payload.matchCount} matches for ${teamName.toLowerCase()}`, type: 'success' },
        { message: `found ${payload.data.totalGames} ${selectedMap.toLowerCase()} maps for ${teamName.toLowerCase()}`, type: 'success' }
      ]);
      setSelectedTeam(teamName);
      setTeamResult(payload);
      setSelectedMatchId(payload.data.maps[0]?.matchId || '');
    } catch (error) {
      setLogs([{ message: `error: ${error.message}`, type: 'error' }]);
    }
  }

  async function onBrowse() {
    if (!selectedMap) {
      setLogs([{ message: 'please select a map first', type: 'error' }]);
      return;
    }
    if (!selectedRegion) {
      setLogs([{ message: 'please select a region first', type: 'error' }]);
      return;
    }

    clearResults();
    setLogs([
      {
        message: `loading all ${selectedRegion} teams on ${selectedMap.toLowerCase()}`,
        type: 'loading'
      }
    ]);

    try {
      const params = new URLSearchParams({
        region: selectedRegion,
        map: selectedMap
      });
      const payload = await fetchJSON(`/api/browse-all?${params.toString()}`);

      if (payload.overview.length === 0) {
        setLogs([{ message: `no data found for any team on ${selectedMap.toLowerCase()}`, type: 'error' }]);
        return;
      }

      setLogs([{ message: `found data for ${payload.overview.length} teams`, type: 'success' }]);
      setBrowseOverview(payload);
    } catch (error) {
      setLogs([{ message: `error: ${error.message}`, type: 'error' }]);
    }
  }

  const selectedMatch =
    teamResult?.data?.maps.find((entry) => entry.matchId === selectedMatchId) ||
    teamResult?.data?.maps?.[0] ||
    null;

  return (
    <div className="container">
      <div className="header">
        <h1>
          <span className="prompt">&gt;</span> <span className="name">teamval</span>
        </h1>
      </div>

      <div className="card">
        <div className="prompt-line">
          <span className="p">&gt;</span> select region, map, and team to analyze agent compositions
        </div>

        <div className="controls">
          <select
            aria-label="Select region"
            value={selectedRegion}
            onChange={(event) => onRegionChange(event.target.value)}
          >
            <option value="">select region</option>
            {(bootstrap?.regions || []).map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>

          <select
            aria-label="Select map"
            value={selectedMap}
            onChange={(event) => {
              setSelectedMap(event.target.value);
              clearResults();
            }}
          >
            <option value="">select map</option>
            {MAPS.map((map) => (
              <option key={map} value={map}>
                {map.toLowerCase()}
              </option>
            ))}
          </select>

          {selectedRegion ? (
            <select
              aria-label="Select team"
              value={selectedTeam}
              onChange={(event) => setSelectedTeam(event.target.value)}
            >
              <option value="">select team</option>
              {regionTeams.map((team) => (
                <option key={team} value={team}>
                  {team.toLowerCase()}
                </option>
              ))}
            </select>
          ) : null}

          <button type="button" className="search-btn" onClick={() => onSearch()}>
            search
          </button>

          <span className="separator">|</span>

          <button type="button" onClick={onBrowse}>
            browse all
          </button>
        </div>

        <div className="log">
          {logs.map((entry, index) => (
            <div
              key={`${entry.message}-${index}`}
              className={`log-line${entry.type === 'error' ? ' error' : entry.type === 'success' ? ' success' : ''}`}
            >
              <span className="p">&gt;</span> {entry.message}
              {entry.type === 'loading' ? <span className="loading-dots" /> : null}
            </div>
          ))}
        </div>

        {teamResult ? (
          <div className="results">
            <div>
              <div className="results-header">MAP WIN RATE</div>
              <div className="results-divider">{'\u2500'.repeat(60)}</div>
              {(() => {
                const winRate = Math.round(teamResult.data.winRate * 100);
                const winRateClass = classifyWinRate(winRate);
                const label = winRate >= 60 ? 'W' : winRate >= 45 ? '~' : 'L';

                return (
                  <div className="winrate-row">
                    <span className="winrate-map">{teamResult.map.toLowerCase()}</span>
                    <div className="winrate-bar-container">
                      <div className={`winrate-bar ${winRateClass}`} style={{ width: `${winRate}%` }} />
                    </div>
                    <span className="winrate-record">
                      {teamResult.data.wins}/{teamResult.data.totalGames}
                    </span>
                    <span className={`winrate-pct winrate-label ${winRateClass}`}>{winRate}%</span>
                    <span className={`winrate-label ${winRateClass}`}>{label}</span>
                  </div>
                );
              })()}
            </div>

            <div className="winrate-section">
              <div className="results-header">RECENT MAPS</div>
              <div className="results-divider">{'\u2500'.repeat(60)}</div>
              <div className="match-list">
                {teamResult.data.maps.map((entry) => (
                  <button
                    key={`${entry.matchId}-${entry.date}-${entry.opponent}`}
                    type="button"
                    className={`match-list-item${selectedMatch?.matchId === entry.matchId ? ' active' : ''}`}
                    onClick={() => setSelectedMatchId(entry.matchId)}
                  >
                    <span className="match-list-meta">
                      {entry.date} · {entry.eventTitle.toLowerCase()}
                    </span>
                    <span className="match-list-title">
                      {entry.team.toLowerCase()} vs {entry.opponent.toLowerCase()}
                    </span>
                    <span className="match-list-score">
                      {entry.score.team}-{entry.score.opponent} {entry.won ? 'W' : 'L'}
                    </span>
                  </button>
                ))}
              </div>

              {selectedMatch ? (
                <div className="match-detail">
                  <div className="match-detail-header">
                    <div>
                      <div className="match-detail-title">
                        {selectedMatch.team.toLowerCase()} vs {selectedMatch.opponent.toLowerCase()}
                      </div>
                      <div className="match-detail-meta">
                        {selectedMatch.date} · {selectedMatch.eventTitle.toLowerCase()} · {teamResult.map.toLowerCase()}
                      </div>
                    </div>
                    <div className={`match-detail-result ${selectedMatch.won ? 'success' : 'error'}`}>
                      {selectedMatch.score.team}-{selectedMatch.score.opponent} {selectedMatch.won ? 'W' : 'L'}
                    </div>
                  </div>

                  <div className="lineup-grid">
                    <div className="lineup-card">
                      <div className="lineup-heading">{selectedMatch.team.toLowerCase()}</div>
                      <div className="lineup-list">
                        {selectedMatch.teamPlayers.map((player) => (
                          <div
                            key={`${selectedMatch.matchId}-team-${player.name}-${player.agent}`}
                            className="lineup-player"
                          >
                            <span className="lineup-player-name">{player.name.toLowerCase()}</span>
                            <span className="lineup-player-agent">{player.agent.toLowerCase()}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lineup-card">
                      <div className="lineup-heading">{selectedMatch.opponent.toLowerCase()}</div>
                      <div className="lineup-list">
                        {selectedMatch.opponentPlayers.map((player) => (
                          <div
                            key={`${selectedMatch.matchId}-opp-${player.name}-${player.agent}`}
                            className="lineup-player"
                          >
                            <span className="lineup-player-name">{player.name.toLowerCase()}</span>
                            <span className="lineup-player-agent">{player.agent.toLowerCase()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {browseOverview ? (
          <div className="results">
            <button type="button" className="back-btn" onClick={clearBrowse}>
              ← back
            </button>
            <div className="browse-table">
              <div className="browse-header">
                <span>team</span>
                <span style={{ textAlign: 'center' }}>w</span>
                <span style={{ textAlign: 'center' }}>l</span>
                <span style={{ textAlign: 'center' }}>win%</span>
                <span>top comp</span>
              </div>

              {browseOverview.overview.map((row) => {
                const percentage = Math.round(row.winRate * 100);
                const winRateClass = classifyWinRate(percentage);

                return (
                  <button
                    key={row.team}
                    type="button"
                    className="browse-row"
                    onClick={() => onSearch(row.team)}
                  >
                    <span className="browse-team">{row.team}</span>
                    <span className="browse-w">{row.wins}</span>
                    <span className="browse-l">{row.losses}</span>
                    <span className={`browse-winpct winrate-label ${winRateClass}`}>{percentage}%</span>
                    <span className="browse-agents">{row.topComposition.join(', ')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="footer">
        scraped directly from{' '}
        <a href="https://vlr.gg" target="_blank" rel="noopener noreferrer">
          vlr.gg
        </a>
      </div>
    </div>
  );
}
