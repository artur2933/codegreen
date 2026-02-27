import { Injectable, signal, inject } from '@angular/core';
import { Match, LEAGUES } from './data.service';
import { LicenseService } from './license.service';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private licenseService = inject(LicenseService);
  private analysisCache = new Map<string, string>();
  private readonly CACHE_KEY = 'gemini_analysis_cache';

  constructor() {
    this.loadCache();
  }

  // ... (loadCache and saveCache methods remain same)

  private loadCache() {
    try {
      const stored = localStorage.getItem(this.CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.analysisCache = new Map(parsed);
      }
    } catch (e) {
      console.warn('Failed to load analysis cache', e);
    }
  }

  private saveCache() {
    try {
      const serialized = JSON.stringify(Array.from(this.analysisCache.entries()));
      localStorage.setItem(this.CACHE_KEY, serialized);
    } catch (e) {
      console.warn('Failed to save analysis cache', e);
    }
  }

  async generateDailyMatches(league: string): Promise<any[]> {
    try {
      const response = await fetch('/api/generate-ticket', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'x-license-key': this.licenseService.licenseKey()
        },
        body: JSON.stringify({ league })
      });

      if (!response.ok) throw new Error('Failed to generate ticket');
      return await response.json();
    } catch (error) {
      console.error('Gemini Match Generation Error:', error);
      return [];
    }
  }

  async analyzeMatch(match: Match): Promise<string> {
    if (this.analysisCache.has(match.id)) {
      return this.analysisCache.get(match.id)!;
    }

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'x-license-key': this.licenseService.licenseKey()
        },
        body: JSON.stringify({ match })
      });

      if (!response.ok) {
          if (response.status === 503) return "AI Service Unavailable (Check API Key)";
          throw new Error('Analysis failed');
      }

      const data = await response.json();
      const text = data.analysis || "Analysis unavailable.";
      
      this.analysisCache.set(match.id, text);
      this.saveCache();
      return text;
    } catch (error: any) {
      console.error('Gemini Error:', error);
      return "AI system currently overloaded.";
    }
  }
}