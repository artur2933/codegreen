import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LicenseService {
  private http = inject(HttpClient);
  private readonly LICENSE_KEY = 'betpro_license_key';
  
  // State
  licenseKey = signal<string>('');
  isValid = signal<boolean>(false); // Default to false until validated
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  
  // Whop metadata
  planName = signal<string>('Free Tier');
  
  constructor() {
    this.loadLicense();
  }

  private async loadLicense() {
    const saved = localStorage.getItem(this.LICENSE_KEY);
    if (saved) {
      await this.validateLicense(saved);
    }
  }

  async validateLicense(key: string): Promise<boolean> {
    this.isLoading.set(true);
    this.error.set(null);
    
    try {
      // Call our backend proxy
      const response = await firstValueFrom(
        this.http.post<{ valid: boolean, plan?: string, message?: string }>('/api/validate-license', { key })
      );

      if (response.valid) {
        this.licenseKey.set(key);
        this.isValid.set(true);
        this.planName.set(response.plan || 'PRO ACCESS');
        localStorage.setItem(this.LICENSE_KEY, key);
        return true;
      } else {
        this.isValid.set(false);
        this.error.set(response.message || 'Invalid license key');
        return false;
      }
    } catch (e) {
      console.error('License validation failed', e);
      this.isValid.set(false);
      this.error.set('Connection error. Please try again.');
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  logout() {
    this.licenseKey.set('');
    this.isValid.set(false);
    this.planName.set('Free Tier');
    localStorage.removeItem(this.LICENSE_KEY);
  }
}
