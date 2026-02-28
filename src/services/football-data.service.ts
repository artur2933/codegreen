import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FootballDataService {
  constructor() {}

  async getLeagueStandings(leagueCode: string): Promise<any> {
    // Map your internal codes to Football-Data codes
    const codeMap: Record<string, string> = {
      'PL': 'PL',
      'PD': 'PD',
      'BL1': 'BL1',
      'SA': 'SA',
      'L1': 'FL1'
    };

    const code = codeMap[leagueCode];
    if (!code) return null;

    try {
      const response = await fetch(`/api/standings?code=${code}`, {
        headers: {
          'x-license-key': localStorage.getItem('license_key') || ''
        }
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Football-Data Error:', error);
      return null;
    }
  }

  async getMatchHistory(homeTeamId: number, awayTeamId: number): Promise<any> {
    // H2H štatistiky sú v tejto API veľmi kvalitné
    // Implementácia by vyžadovala ID tímov z ich databázy
    return null;
  }
}
