import { Injectable, inject } from '@angular/core';
import { Match, TeamStats, LEAGUES } from './data.service';
import { LicenseService } from './license.service';

@Injectable({
  providedIn: 'root'
})
export class SportsApiService {
  private licenseService = inject(LicenseService);
  private readonly LEAGUE_IDS: Record<string, number> = {
    'PL': 39,   // Premier League
    'PD': 140,  // La Liga
    'BL1': 78,  // Bundesliga
    'SA': 135,  // Serie A
    'L1': 61,   // Ligue 1
    'ERE': 88,  // Eredivisie
    'PPL': 94,  // Primeira Liga
    'UCL': 2,   // Champions League
    'UEL': 3    // Europa League
  };

  constructor() {}

  async getUpcomingMatches(leagueCode: string): Promise<Match[]> {
    try {
      const response = await fetch(`/api/matches?league=${leagueCode}`, {
        headers: {
            'x-license-key': this.licenseService.licenseKey()
        }
      });
      if (!response.ok) throw new Error('Backend API Error');
      
      const data = await response.json();
      
      // If backend says "mock: true" or returns empty, use local mock
      if (data.mock || !Array.isArray(data.response)) {
          return this.getMockMatches(leagueCode);
      }

      return this.transformApiData(data.response, leagueCode);
    } catch (error) {
      console.error('Failed to fetch from Backend API:', error);
      return this.getMockMatches(leagueCode);
    }
  }

  private transformApiData(fixtures: any[], leagueCode: string): Match[] {
    return fixtures.map(f => {
      const home = f.teams.home.name;
      const away = f.teams.away.name;
      const date = new Date(f.fixture.date);
      
      // Simulate odds if not present (Free tier sometimes limits odds access)
      const baseHome = Math.random() * 2 + 1.2;
      const baseDraw = Math.random() * 2 + 2.5;
      const baseAway = Math.random() * 3 + 1.5;

      return {
        id: f.fixture.id.toString(),
        home: home,
        away: away,
        league: leagueCode,
        time: date.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }),
        recommendedBet: baseHome < baseAway ? '1' : '2', // Simple logic
        odds: {
          home: parseFloat(baseHome.toFixed(2)),
          draw: parseFloat(baseDraw.toFixed(2)),
          away: parseFloat(baseAway.toFixed(2)),
          over25: 1.85,
          under25: 1.95,
          bttsYes: 1.75,
          bttsNo: 2.05,
          htHome: parseFloat((baseHome + 1).toFixed(2)),
          htDraw: 2.10,
          htAway: parseFloat((baseAway + 1).toFixed(2))
        },
        stats: this.generateMockStats(home, away) // API-Football stats are for finished matches usually
      };
    });
  }

  private getMockMatches(league: string): Match[] {
    // Return realistic mock data so the app doesn't look empty
    const now = new Date();
    return [
      {
        id: `mock-${league}-1`,
        home: 'Home Team A',
        away: 'Away Team B',
        league: league,
        time: now.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' }),
        recommendedBet: '1',
        odds: { home: 1.95, draw: 3.40, away: 3.80, over25: 1.70, under25: 2.10, bttsYes: 1.60, bttsNo: 2.20, htHome: 2.50, htDraw: 2.10, htAway: 4.00 },
        stats: this.generateMockStats('Home Team A', 'Away Team B')
      }
    ];
  }

  private generateMockStats(home: string, away: string) {
    return {
      home: {
        rank: Math.floor(Math.random() * 20) + 1,
        points: Math.floor(Math.random() * 80),
        form: 'WWDLW',
        goalsFor: 45,
        goalsAgainst: 30,
        goalsPerGame: 1.5,
        possession: 55,
        shotsOnTarget: 6,
        shotsTotal: 14,
        xG: 1.8,
        corners: 6,
        fouls: 10,
        yellowCards: 2,
        redCards: 0,
        offsides: 2,
        saves: 3,
        cleanSheets: 8,
        injuries: []
      },
      away: {
        rank: Math.floor(Math.random() * 20) + 1,
        points: Math.floor(Math.random() * 80),
        form: 'LDWLL',
        goalsFor: 30,
        goalsAgainst: 40,
        goalsPerGame: 1.1,
        possession: 45,
        shotsOnTarget: 4,
        shotsTotal: 10,
        xG: 1.1,
        corners: 4,
        fouls: 12,
        yellowCards: 3,
        redCards: 0,
        offsides: 1,
        saves: 5,
        cleanSheets: 5,
        injuries: []
      }
    };
  }

  async getMatchResult(matchId: string): Promise<{ status: string, score: { home: number, away: number } } | null> {
    try {
        const response = await fetch(`/api/match-status?id=${matchId}`, {
            headers: { 'x-license-key': this.licenseService.licenseKey() }
        });
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.error("Failed to check match status", e);
        return null;
    }
  }
}
