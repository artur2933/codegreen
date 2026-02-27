import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SportmonksService {
  private readonly API_URL = 'https://api.sportmonks.com/v3/football';
  private readonly API_KEY = process.env['SPORTMONKS_API_KEY'] || '';

  constructor() {}

  async getAdvancedStats(matchId: string): Promise<any> {
    if (!this.API_KEY) return null;

    // Sportmonks uses its own IDs, mapping would be needed for a real production app.
    // For now, we'll create the structure to fetch advanced metrics like xG.
    try {
      const response = await fetch(`${this.API_URL}/fixtures/${matchId}?include=statistics;expectedGoals`, {
        headers: { 'Authorization': this.API_KEY }
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Sportmonks Error:', error);
      return null;
    }
  }

  async getTeamAdvancedMetrics(teamId: string): Promise<any> {
    if (!this.API_KEY) return null;
    
    try {
      // Fetching team seasons stats which often include xG per game etc.
      const response = await fetch(`${this.API_URL}/teams/${teamId}?include=statistics`, {
        headers: { 'Authorization': this.API_KEY }
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.data;
    } catch (error) {
      console.error('Sportmonks Team Stats Error:', error);
      return null;
    }
  }
}
