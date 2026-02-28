import { Injectable, signal, inject } from '@angular/core';
import { SportsApiService } from './sports-api.service';
import { FootballDataService } from './football-data.service';
import { SportmonksService } from './sportmonks.service';

export const LEAGUES = ['PL', 'PD', 'BL1', 'SA', 'L1', 'ERE', 'PPL', 'UCL', 'UEL'] as const;
export type League = typeof LEAGUES[number];

export interface TeamStats {
  rank: number;
  points: number;
  form: string;
  goalsFor: number;
  goalsAgainst: number;
  goalsPerGame: number;
  possession: number;
  shotsOnTarget: number;
  shotsTotal: number;
  xG: number;         // Expected Goals
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  offsides: number;
  saves: number;
  cleanSheets: number;
  injuries: string[];
}

export interface Match {
  id: string;
  home: string;
  away: string;
  league: string;
  recommendedBet: '1' | 'X' | '2';
  odds: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    under25: number;
    bttsYes: number;
    bttsNo: number;
    htHome: number;
    htDraw: number;
    htAway: number;
  };
  stats: {
    home: TeamStats;
    away: TeamStats;
  };
  time: string;
}

export interface Prediction {
  id: string;
  matchId: string;
  home: string;
  away: string;
  marketName: string;
  selectionName: string;
  odds: number;
  reasoning?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private sportsApi = inject(SportsApiService);
  private footballDataApi = inject(FootballDataService);
  private sportmonksApi = inject(SportmonksService);
  
  private dynamicMatches = signal<Match[]>([]);
  public isOfflineMode = signal<boolean>(false);

  setMatches(matches: Match[]) {
    this.dynamicMatches.set(matches);
  }
  
  async loadMatchesFromApi(leagues: string[]) {
    try {
        const promises = leagues.map(async league => {
          let matches: Match[] = [];
          try {
              matches = await this.sportsApi.getUpcomingMatches(league);
          } catch (e) {
              console.warn(`Failed to fetch matches for ${league}, using fallback.`);
              // If individual league fails, return empty or fallback (handled by catch block below if all fail)
              return [];
          }

          // Enrich with Standings (Football-Data.org) - Optional, don't fail if this fails
          try {
              const standings = await this.footballDataApi.getLeagueStandings(league);
              if (standings && standings.standings) {
                const table = standings.standings[0].table;
                matches.forEach(m => {
                  const homeInTable = table.find((t: any) => t.team.name.includes(m.home) || m.home.includes(t.team.name));
                  const awayInTable = table.find((t: any) => t.team.name.includes(m.away) || m.away.includes(t.team.name));
                  
                  if (homeInTable) {
                    m.stats.home.rank = homeInTable.position;
                    m.stats.home.points = homeInTable.points;
                    m.stats.home.form = homeInTable.form || m.stats.home.form;
                  }
                  if (awayInTable) {
                    m.stats.away.rank = awayInTable.position;
                    m.stats.away.points = awayInTable.points;
                    m.stats.away.form = awayInTable.form || m.stats.away.form;
                  }
                });
              }
          } catch (e) {
              console.warn(`Failed to enrich standings for ${league}`, e);
          }

          // Enrich with Advanced Stats (Sportmonks) - Simulation
          matches.forEach(m => {
              m.stats.home.xG = Number((Math.random() * 1 + 1.2).toFixed(2));
              m.stats.away.xG = Number((Math.random() * 1 + 1.0).toFixed(2));
              m.stats.home.possession = Math.floor(Math.random() * 20) + 40;
              m.stats.away.possession = 100 - m.stats.home.possession;
          });

          return matches;
        });

        const results = await Promise.all(promises);
        const allMatches = results.flat();
        
        if (allMatches.length === 0) {
            throw new Error("No matches found from API");
        }

        this.setMatches(allMatches);
        this.isOfflineMode.set(false);
        return allMatches;

    } catch (error) {
        console.error("CRITICAL: Failed to load matches from API. Switching to Offline Mode.", error);
        this.isOfflineMode.set(true);
        const fallbackMatches = this.generateFallbackMatches();
        this.setMatches(fallbackMatches);
        return fallbackMatches;
    }
  }
  
  // Robust Fallback Generator
  private generateFallbackMatches(): Match[] {
      const leagues = ['PL', 'PD', 'BL1', 'SA', 'L1'];
      const teams: Record<string, string[]> = {
          'PL': ['Arsenal', 'Man City', 'Liverpool', 'Chelsea', 'Spurs', 'Man Utd'],
          'PD': ['Real Madrid', 'Barcelona', 'Atletico', 'Sevilla', 'Valencia', 'Betis'],
          'BL1': ['Bayern', 'Dortmund', 'Leipzig', 'Leverkusen', 'Frankfurt', 'Wolfsburg'],
          'SA': ['Juventus', 'Inter', 'Milan', 'Napoli', 'Roma', 'Lazio'],
          'L1': ['PSG', 'Marseille', 'Lyon', 'Monaco', 'Lille', 'Rennes']
      };

      const matches: Match[] = [];
      
      leagues.forEach(league => {
          const leagueTeams = teams[league] || [];
          for(let i=0; i<leagueTeams.length; i+=2) {
              if(i+1 >= leagueTeams.length) break;
              matches.push(this.createMockMatch(leagueTeams[i], leagueTeams[i+1], league));
          }
      });
      
      return matches;
  }

  private createMockMatch(home: string, away: string, league: string): Match {
      return {
          id: `mock-${Math.random().toString(36).substr(2, 9)}`,
          home, away, league,
          recommendedBet: Math.random() > 0.6 ? '1' : (Math.random() > 0.5 ? 'X' : '2'),
          odds: {
              home: Number((Math.random() * 1.5 + 1.5).toFixed(2)),
              draw: Number((Math.random() * 1 + 3.0).toFixed(2)),
              away: Number((Math.random() * 2 + 2.0).toFixed(2)),
              over25: Number((Math.random() * 0.8 + 1.5).toFixed(2)),
              under25: Number((Math.random() * 0.8 + 1.5).toFixed(2)),
              bttsYes: Number((Math.random() * 0.6 + 1.6).toFixed(2)),
              bttsNo: Number((Math.random() * 0.6 + 1.8).toFixed(2)),
              htHome: Number((Math.random() * 2 + 2.0).toFixed(2)),
              htDraw: Number((Math.random() * 1 + 2.0).toFixed(2)),
              htAway: Number((Math.random() * 3 + 3.0).toFixed(2))
          },
          stats: {
              home: this.createMockStats(),
              away: this.createMockStats()
          },
          time: '20:45'
      };
  }

  private createMockStats(): TeamStats {
      return {
          rank: Math.floor(Math.random() * 20) + 1,
          points: Math.floor(Math.random() * 80) + 10,
          form: 'WDLWW',
          goalsFor: Math.floor(Math.random() * 50) + 20,
          goalsAgainst: Math.floor(Math.random() * 40) + 20,
          goalsPerGame: Number((Math.random() * 2 + 0.5).toFixed(1)),
          possession: 50,
          shotsOnTarget: Math.floor(Math.random() * 5) + 2,
          shotsTotal: Math.floor(Math.random() * 10) + 5,
          xG: Number((Math.random() * 2).toFixed(2)),
          corners: Math.floor(Math.random() * 8) + 2,
          fouls: Math.floor(Math.random() * 12) + 5,
          yellowCards: Math.floor(Math.random() * 3),
          redCards: 0,
          offsides: Math.floor(Math.random() * 3),
          saves: Math.floor(Math.random() * 5),
          cleanSheets: Math.floor(Math.random() * 10),
          injuries: []
      };
  }
  
  getMatches(league: string): Match[] {
    // If we have dynamic matches, use them (filtered by league if needed)
    if (this.dynamicMatches().length > 0) {
        if (league === 'ALL') return this.dynamicMatches();
        return this.dynamicMatches().filter(m => m.league === league);
    }

    // Fallback to empty or base matches if API fails/not loaded yet
    return [];
  }

  generatePredictions(risk: 'low' | 'high', leagues: string[] = []): Prediction[] {
    let all = this.getMatches('ALL');
    
    // Filter by leagues if provided
    if (leagues.length > 0) {
        all = all.filter(m => leagues.includes(m.league));
    }

    const predictions: Prediction[] = [];

    all.forEach(m => {
        const options = [
            { market: 'Víťaz', sel: m.home, odds: m.odds.home },
            { market: 'Víťaz', sel: 'Remíza', odds: m.odds.draw },
            { market: 'Víťaz', sel: m.away, odds: m.odds.away },
            { market: 'Góly', sel: 'Nad 2.5', odds: m.odds.over25 },
            { market: 'Góly', sel: 'Pod 2.5', odds: m.odds.under25 },
            { market: 'BTTS', sel: 'Áno', odds: m.odds.bttsYes },
            { market: 'Polčas', sel: `Výhra ${m.home}`, odds: m.odds.htHome },
            { market: 'Polčas', sel: 'Remíza', odds: m.odds.htDraw }
        ];

        let validOptions: typeof options = [];
        if (risk === 'low') {
            validOptions = options.filter(o => o.odds >= 1.25 && o.odds <= 1.65);
        } else {
            validOptions = options.filter(o => o.odds >= 1.85 && o.odds <= 3.00);
        }

        validOptions.forEach(opt => {
            predictions.push({
                id: Math.random().toString(36).substr(2, 5),
                matchId: m.id,
                home: m.home,
                away: m.away,
                marketName: opt.market,
                selectionName: opt.sel,
                odds: opt.odds
            });
        });
    });

    return predictions;
  }

  getDailyTicketPredictions(): Prediction[] {
    const all = this.generatePredictions('low');
    const sorted = all.sort((a,b) => a.odds - b.odds);
    
    const distinctMatches: Prediction[] = [];
    const usedIds = new Set<string>();
    
    for (const p of sorted) {
        if (!usedIds.has(p.matchId) && distinctMatches.length < 3) {
            distinctMatches.push(p);
            usedIds.add(p.matchId);
        }
    }
    
    return distinctMatches;
  }

  checkOutcome(market: string, selection: string, home: string, away: string, hScore: number, aScore: number): boolean {
      const total = hScore + aScore;

      // Match Winner
      if (market === 'Víťaz' || market === 'Match Winner' || market === '1X2') {
          if (selection === home) return hScore > aScore;
          if (selection === away) return aScore > hScore;
          if (selection === 'Remíza' || selection === 'Draw') return hScore === aScore;
      }

      // Goals Over/Under
      if (market === 'Góly' || market === 'Goals') {
          if (selection.includes('Nad') || selection.includes('Over')) {
              const line = parseFloat(selection.replace(/[^0-9.]/g, ''));
              return !isNaN(line) && total > line;
          }
          if (selection.includes('Pod') || selection.includes('Under')) {
              const line = parseFloat(selection.replace(/[^0-9.]/g, ''));
              return !isNaN(line) && total < line;
          }
      }

      // BTTS
      if (market === 'BTTS' || market === 'Oba tímy dajú gól') {
          if (selection === 'Áno' || selection === 'Yes') return hScore > 0 && aScore > 0;
          if (selection === 'Nie' || selection === 'No') return hScore === 0 || aScore === 0;
      }

      return false;
  }
}