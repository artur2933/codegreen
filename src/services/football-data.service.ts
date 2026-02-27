import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FootballDataService {
  private readonly API_URL = 'https://api.football-data.org/v4';
  private readonly API_KEY = process.env['FOOTBALL_DATA_API_KEY'] || '';

  constructor() {}

  async getLeagueStandings(leagueCode: string): Promise<any> {
    if (!this.API_KEY) return null;

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
      const response = await fetch(`${this.API_URL}/competitions/${code}/standings`, {
        headers: { 'X-Auth-Token': this.API_KEY }
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
    if (!this.API_KEY) return null;
    // Implementácia by vyžadovala ID tímov z ich databázy
    return null;
  }
}
