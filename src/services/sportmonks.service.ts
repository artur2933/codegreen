import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SportmonksService {
  constructor() {}

  async getAdvancedStats(matchId: string): Promise<any> {
    // Sportmonks uses its own IDs, mapping would be needed for a real production app.
    // For now, we'll create the structure to fetch advanced metrics like xG.
    try {
      const response = await fetch(`/api/advanced-stats?matchId=${matchId}`, {
        headers: {
          'x-license-key': localStorage.getItem('license_key') || ''
        }
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Sportmonks Error:', error);
      return null;
    }
  }

  async getTeamAdvancedMetrics(teamId: string): Promise<any> {
    // We would need another endpoint for this, but for now we'll just return null
    // as it's not currently used in the main flow.
    return null;
  }
}
