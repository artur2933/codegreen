import { Component, inject, signal, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { BankrollService } from './services/bankroll.service';
import { DataService, Match, Prediction, LEAGUES, League } from './services/data.service';
import { SportsApiService } from './services/sports-api.service';
import { GeminiService } from './services/gemini.service';
import { LicenseService } from './services/license.service';
import { SparklineComponent } from './components/sparkline.component';

type View = 'dashboard' | 'ticket-dna' | 'analysis' | 'generator' | 'my-bets';
type Timeframe = '7d' | '30d' | 'ytd';
type LedgerFilter = 'ALL' | 'WON' | 'LOST' | 'PENDING';

interface PendingBet {
  description: string;
  selection: string;
  odds: number;
  stake: number;
  return: number;
  details?: string[];
  matchId?: string; // Added for result checking
  // Kelly Calc Props
  confidence?: number; // User estimation 0-100
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SparklineComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {
  bankroll = inject(BankrollService);
  dataService = inject(DataService);
  sportsApi = inject(SportsApiService);
  gemini = inject(GeminiService);
  licenseService = inject(LicenseService);
  titleService = inject(Title);

  async checkTicketStatus() {
      const pending = this.bankroll.activeBets();
      if (pending.length === 0) {
          this.triggerToast('Žiadne čakajúce tikety na vyhodnotenie.', 'error');
          return;
      }

      this.triggerToast('Overujem výsledky zápasov...', 'success');
      
      let resolvedCount = 0;
      let wins = 0;
      let losses = 0;

      for (const bet of pending) {
          if (bet.matchId) {
              const result = await this.sportsApi.getMatchResult(bet.matchId);
              
              if (result && (result.status === 'FT' || result.status === 'AET' || result.status === 'PEN')) {
                  const parts = bet.match.split(' vs ');
                  if (parts.length >= 2) {
                      const home = parts[0];
                      const away = parts[1].split(' (')[0]; 
                      
                      let market = '1X2';
                      if (bet.match.includes('(')) {
                          const matchStr = bet.match;
                          const marketPart = matchStr.substring(matchStr.lastIndexOf('(') + 1, matchStr.lastIndexOf(')'));
                          market = marketPart;
                      } else if (bet.selection.includes('Over') || bet.selection.includes('Under') || bet.selection.includes('Nad') || bet.selection.includes('Pod')) {
                          market = 'Goals';
                      } else if (bet.selection === 'Áno' || bet.selection === 'Nie' || bet.selection === 'Yes' || bet.selection === 'No') {
                          market = 'BTTS';
                      }

                      const isWin = this.dataService.checkOutcome(market, bet.selection, home, away, result.score.home, result.score.away);
                      
                      this.bankroll.resolveBet(bet.id, isWin);
                      resolvedCount++;
                      if (isWin) wins++; else losses++;
                  }
              }
          }
      }

      if (resolvedCount > 0) {
          this.triggerToast(`Vyhodnotené: ${wins} Výhier, ${losses} Prehier`, 'success');
      } else {
          this.triggerToast('Žiadne zápasy zatiaľ neskončili.', 'error');
      }
  }

  // App View State
  currentView = signal<View>('dashboard');
  selectedLeague = signal<League>('PL');
  leagues = LEAGUES;

  // Login State
  loginKey = signal('');
  isLoggingIn = computed(() => this.licenseService.isLoading());
  loginError = computed(() => this.licenseService.error());

  async handleLogin() {
    if (!this.loginKey()) return;
    await this.licenseService.validateLicense(this.loginKey());
  }

  // Data Signals
  matches = computed(() => this.dataService.getMatches(this.selectedLeague()));
  isLoadingMatches = signal<boolean>(false);
  matchesError = signal<boolean>(false);

  updateTitle() {
      const viewMap: Record<View, string> = {
          'dashboard': 'Dashboard',
          'ticket-dna': 'Tiket Dňa',
          'analysis': 'Analýza',
          'generator': 'AI Engine',
          'my-bets': 'Moje Tikety'
      };
      this.titleService.setTitle(`Bet PRO AI - ${viewMap[this.currentView()]}`);
  }

  async loadDynamicMatches() {
    this.isLoadingMatches.set(true);
    this.matchesError.set(false);
    try {
        // Fetch matches from Sports API
        await this.dataService.loadMatchesFromApi([...this.leagues]);
        
        // Generate AI Ticket based on loaded matches
        await this.generateAITicket();
        
        this.triggerToast('Live dáta úspešne načítané (Sports API)', 'success');
    } catch (e) {
        console.error("Failed to load dynamic matches", e);
        this.matchesError.set(true);
        this.triggerToast('Nepodarilo sa načítať live dáta', 'error');
    } finally {
        this.isLoadingMatches.set(false);
    }
  }

  async generateAITicket() {
      const matches = this.dataService.getMatches('ALL');
      if (matches.length === 0) return;

      try {
          // Default to 'low' risk for the daily ticket
          const aiPredictions = await this.gemini.generateDailyMatches('ALL', 'low', matches);
          
          if (aiPredictions && aiPredictions.length > 0) {
              const mappedPredictions: Prediction[] = aiPredictions.map(p => {
                  const match = matches.find(m => m.id === p.matchId);
                  return {
                      id: Math.random().toString(36).substr(2, 5),
                      matchId: p.matchId,
                      home: match ? match.home : 'Unknown',
                      away: match ? match.away : 'Unknown',
                      marketName: p.marketName || 'Víťaz',
                      selectionName: p.selectionName || '1',
                      odds: p.odds || 1.5,
                      reasoning: p.reasoning
                  };
              });
              this.dailyTicketPredictions.set(mappedPredictions);
          } else {
              // Fallback if AI fails
              this.dailyTicketPredictions.set(this.dataService.getDailyTicketPredictions());
          }
      } catch (e: any) {
          console.error("AI Ticket generation failed, using fallback", e);
          if (e.message && (e.message.includes('limit') || e.message.includes('licencia'))) {
              this.triggerToast(e.message, "error");
          }
          this.dailyTicketPredictions.set(this.dataService.getDailyTicketPredictions());
      }
  }

  // UI State
  expandedMatchId = signal<string | null>(null);
  currentStake = signal<number>(50);
  ledgerFilter = signal<LedgerFilter>('ALL');
  
  // Balance Editing
  isEditingBalance = signal(false);
  tempBalanceValue = signal(0);
  @ViewChild('balanceInput') balanceInput?: ElementRef;
  
  // Pagination State
  ledgerPage = signal(0);
  readonly ledgerPageSize = 5; 
  
  // Modal State
  showBetModal = signal(false);
  pendingBet = signal<PendingBet | null>(null);
  isProcessingBet = signal(false);
  betSuccess = signal(false);

  // Dashboard State
  graphTimeframe = signal<Timeframe>('7d');
  
  // Generator State
  riskLevel = signal<'low' | 'high'>('low');
  generatorLeagues = signal<string[]>([...this.leagues]);
  generatedTicket = signal<Prediction[]>([]);
  
  // Daily Ticket State
  dailyTicketPredictions = signal<Prediction[]>([]);
  
  // Analysis State
  matchAnalysis = signal<Record<string, string>>({});
  analyzingMatches = signal<Record<string, boolean>>({});

  // Toast State
  showToast = signal(false);
  toastMessage = signal('');
  toastType = signal<'success' | 'error'>('success');
  
  // Legal & Age Gate
  showAgeGate = signal(true);
  showLegalModal = signal<'terms' | 'privacy' | null>(null);
  
  // Settings
  showSettingsModal = signal(false);

  // Urgency Timer
  countdown = signal('00:00:00');
  private timerInterval: any;

  constructor() {
    this.checkAgeGate();
    this.startCountdown();
    
    // Only load data if already logged in
    if (this.licenseService.isValid()) {
        this.loadDynamicMatches();
    }
    
    // Listen for login changes
    effect(() => {
        if (this.licenseService.isValid()) {
            this.loadDynamicMatches();
        }
    });

    this.updateTitle();
    
    effect(() => {
        this.updateTitle();
    });
  }

  openSettings() {
      this.showSettingsModal.set(true);
  }

  closeSettings() {
      this.showSettingsModal.set(false);
  }

  resetSimulation() {
      if (confirm('Naozaj chcete resetovať celú simuláciu? Všetky dáta budú stratené.')) {
          this.bankroll.reset();
          localStorage.removeItem('gemini_analysis_cache');
          this.triggerToast('Simulácia bola resetovaná', 'success');
          this.closeSettings();
          // Optional: Reload page to ensure clean state
          window.location.reload();
      }
  }

  logout() {
      if (confirm('Chcete sa odhlásiť?')) {
          this.licenseService.logout();
          this.closeSettings();
          this.triggerToast('Boli ste odhlásený', 'success');
      }
  }

  startCountdown() {
    const update = () => {
        const now = new Date();
        const target = new Date(now);
        // Target next 4-hour block (00, 04, 08, 12, 16, 20)
        let nextHour = Math.ceil((now.getHours() + 1) / 4) * 4;
        if (nextHour >= 24) {
            target.setHours(24, 0, 0, 0);
        } else {
            target.setHours(nextHour, 0, 0, 0);
        }
        
        let diff = target.getTime() - now.getTime();
        
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        this.countdown.set(
            `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
        );
    };
    
    update();
    this.timerInterval = setInterval(update, 1000);
  }

  checkAgeGate() {
      const accepted = localStorage.getItem('betpro_age_gate_accepted');
      if (accepted === 'true') {
          this.showAgeGate.set(false);
      }
  }

  acceptAgeGate() {
      localStorage.setItem('betpro_age_gate_accepted', 'true');
      this.showAgeGate.set(false);
  }

  openLegal(type: 'terms' | 'privacy') {
      this.showLegalModal.set(type);
  }

  closeLegal() {
      this.showLegalModal.set(null);
  }
  
  // --- COMPUTED VALUES ---
  
  activeExposure = computed(() => {
    return this.bankroll.activeBets().reduce((acc, bet) => acc + bet.stake, 0);
  });

  // Win Rate & ROI Stats
  performanceStats = computed(() => {
    const hist = this.bankroll.history(); // finished bets
    const totalBets = hist.length;
    if (totalBets === 0) return { winRate: 0, roi: 0 };

    const wins = hist.filter(b => b.status === 'won').length;
    const winRate = (wins / totalBets) * 100;

    const totalStaked = hist.reduce((acc, b) => acc + b.stake, 0);
    const totalReturned = hist.reduce((acc, b) => b.status === 'won' ? acc + (b.stake * b.odds) : acc, 0);
    const netProfit = totalReturned - totalStaked;
    
    // ROI %
    const roi = totalStaked > 0 ? (netProfit / totalStaked) * 100 : 0;

    return { winRate, roi };
  });
  
  dailyTicketTotalOdds = computed(() => {
    const preds = this.dailyTicketPredictions();
    if (preds.length === 0) return 0;
    return preds.reduce((acc, p) => acc * p.odds, 1);
  });

  // Pagination & Filtering Logic
  filteredLedger = computed(() => {
      const all = this.bankroll.allBets(); // includes pending
      const filter = this.ledgerFilter();
      
      let filtered = all;
      if (filter === 'WON') filtered = all.filter(b => b.status === 'won');
      else if (filter === 'LOST') filtered = all.filter(b => b.status === 'lost');
      else if (filter === 'PENDING') filtered = all.filter(b => b.status === 'pending');
      
      // Sort: Pending first, then by timestamp DESC
      return filtered.sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          return b.timestamp - a.timestamp;
      });
  });

  paginatedLedger = computed(() => {
      const list = this.filteredLedger();
      const start = this.ledgerPage() * this.ledgerPageSize;
      return list.slice(start, start + this.ledgerPageSize);
  });

  hasPrevPage = computed(() => this.ledgerPage() > 0);
  hasNextPage = computed(() => {
      return (this.ledgerPage() + 1) * this.ledgerPageSize < this.filteredLedger().length;
  });

  // Chart Labels Generator
  chartLabels = computed(() => {
    const tf = this.graphTimeframe();
    const today = new Date();
    const labels: string[] = [];

    if (tf === '7d') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            labels.push(d.toLocaleDateString('sk-SK', { weekday: 'short' }));
        }
    } else if (tf === '30d') {
        labels.push('W-4', 'W-3', 'W-2', 'W-1', 'Now');
    } else {
        return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    }
    return labels;
  });

  chartData = computed(() => {
    const hist = this.bankroll.history(); // Bets sorted DESC (finished only)
    const current = this.bankroll.balance();
    const timeframe = this.graphTimeframe();
    
    const now = Date.now();
    let cutoff = 0;
    
    if (timeframe === '7d') cutoff = now - (7 * 24 * 60 * 60 * 1000);
    else if (timeframe === '30d') cutoff = now - (30 * 24 * 60 * 60 * 1000);
    else if (timeframe === 'ytd') cutoff = new Date(new Date().getFullYear(), 0, 1).getTime();

    const timeline: {t: number, v: number}[] = [{t: now, v: current}];
    let tempBalance = current;

    hist.forEach(bet => {
        if (bet.status === 'won') tempBalance -= (bet.stake * bet.odds) - bet.stake;
        else if (bet.status === 'lost') tempBalance += bet.stake;
        timeline.push({t: bet.timestamp, v: tempBalance});
    });

    timeline.sort((a, b) => a.t - b.t);
    const insideWindow = timeline.filter(p => p.t >= cutoff);

    if (insideWindow.length > 0) {
        const firstInside = insideWindow[0];
        if (firstInside.t > cutoff) {
           const firstInsideIndex = timeline.indexOf(firstInside);
           if (firstInsideIndex > 0) {
               const preCutoffPoint = timeline[firstInsideIndex - 1];
               insideWindow.unshift({ t: cutoff, v: preCutoffPoint.v });
           } else {
               insideWindow.unshift({ t: cutoff, v: firstInside.v });
           }
        }
    } else {
        // Safe fallback using array copy + reverse + find
        const reversed = [...timeline].reverse();
        const lastKnown = reversed.find(p => p.t < cutoff) || timeline[0];
        return [lastKnown.v, lastKnown.v];
    }
    
    return insideWindow.map(p => p.v);
  });

  // --- HELPERS ---

  getFormArray(formString: string): string[] {
    return formString.split('');
  }

  getFormColor(result: string): string {
    switch(result) {
      case 'W': return 'bg-green-500 text-black'; 
      case 'D': return 'bg-yellow-500 text-black'; 
      case 'L': return 'bg-gray-500 text-white'; 
      default: return 'bg-gray-700';
    }
  }

  getFormTrend(form: string): number[] {
    return form.split('').map(r => {
      if (r === 'W') return 3;
      if (r === 'D') return 1;
      return 0; // Loss
    });
  }

  // --- ACTIONS ---

  startEditingBalance() {
      this.tempBalanceValue.set(this.bankroll.balance());
      this.isEditingBalance.set(true);
      setTimeout(() => this.balanceInput?.nativeElement.focus(), 50);
  }

  saveBalance() {
      const val = this.tempBalanceValue();
      if (!isNaN(val) && val >= 0) {
          this.bankroll.updateBalance(val);
      }
      this.isEditingBalance.set(false);
  }

  setLedgerFilter(f: LedgerFilter) {
      this.ledgerFilter.set(f);
      this.ledgerPage.set(0);
  }

  prevPage() {
      if (this.hasPrevPage()) this.ledgerPage.update(p => p - 1);
  }

  nextPage() {
      if (this.hasNextPage()) this.ledgerPage.update(p => p + 1);
  }

  async triggerAutoAnalysis(match: Match) {
    if (this.analyzingMatches()[match.id]) return;
    
    this.analyzingMatches.update(prev => ({...prev, [match.id]: true}));
    try {
      const result = await this.gemini.analyzeMatch(match);
      this.matchAnalysis.update(prev => ({...prev, [match.id]: result}));
    } catch (e) {
      console.error("Auto analysis failed", e);
      this.triggerToast("Analýza zlyhala", "error");
    } finally {
      this.analyzingMatches.update(prev => ({...prev, [match.id]: false}));
    }
  }

  setView(view: View) {
    this.currentView.set(view);
    this.expandedMatchId.set(null); 
    this.ledgerPage.set(0);
  }

  setLeague(league: League) {
    this.selectedLeague.set(league);
    this.expandedMatchId.set(null);
  }
  
  setGraphTimeframe(tf: Timeframe) {
      this.graphTimeframe.set(tf);
  }

  toggleMatch(match: Match) {
    if (this.expandedMatchId() === match.id) {
      this.expandedMatchId.set(null);
    } else {
      this.expandedMatchId.set(match.id);
      // Auto-trigger analysis if not already present
      if (!this.matchAnalysis()[match.id]) {
          this.triggerAutoAnalysis(match);
      }
    }
  }



  setRisk(level: 'low' | 'high') {
    this.riskLevel.set(level);
  }

  toggleGeneratorLeague(league: string) {
    this.generatorLeagues.update(current => {
      if (current.includes(league)) {
        return current.filter(l => l !== league);
      } else {
        return [...current, league];
      }
    });
  }

  async generateTicket() {
    if (this.generatorLeagues().length === 0) {
      this.triggerToast("Vyberte aspoň jednu ligu!", "error");
      return;
    }
    
    // Get all matches for selected leagues
    let matches = this.dataService.getMatches('ALL');
    matches = matches.filter(m => this.generatorLeagues().includes(m.league));
    
    if (matches.length === 0) {
        this.triggerToast("Nenašli sa zápasy vo vybraných ligách.", "error");
        return;
    }

    this.triggerToast("AI analyzuje zápasy...", "success");
    
    try {
        const aiPredictions = await this.gemini.generateDailyMatches('ALL', this.riskLevel(), matches);
        
        if (aiPredictions && aiPredictions.length > 0) {
            const mappedPredictions: Prediction[] = aiPredictions.map(p => {
                const match = matches.find(m => m.id === p.matchId);
                return {
                    id: Math.random().toString(36).substr(2, 5),
                    matchId: p.matchId,
                    home: match ? match.home : 'Unknown',
                    away: match ? match.away : 'Unknown',
                    marketName: p.marketName || 'Víťaz',
                    selectionName: p.selectionName || '1',
                    odds: p.odds || 1.5,
                    reasoning: p.reasoning
                };
            });
            this.generatedTicket.set(mappedPredictions);
            this.triggerToast("Tiket bol vygenerovaný", "success");
        } else {
            this.triggerToast("Generovanie zlyhalo, skúste znova.", "error");
        }
    } catch (e: any) {
        console.error("AI Ticket generation failed", e);
        this.triggerToast(e.message || "Generovanie zlyhalo, skúste znova.", "error");
    }
  }

  // --- BETTING SYSTEM ---

  initiateBet(description: string, selection: string, odds: number, stake: number, details?: string[], matchId?: string) {
      this.pendingBet.set({
          description,
          selection,
          odds,
          stake,
          return: stake * odds,
          details,
          matchId,
          confidence: 60 // default confidence
      });
      this.showBetModal.set(true);
  }

  updateConfidence(val: string | number) {
      const numVal = typeof val === 'string' ? parseInt(val, 10) : val;
      if (!isNaN(numVal)) {
          this.pendingBet.update(b => b ? { ...b, confidence: numVal } : null);
      }
  }

  applyKelly() {
      const bet = this.pendingBet();
      if (!bet) return;
      
      const odds = Number(bet.odds);
      const confidence = Number(bet.confidence || 50);
      const bank = Number(this.bankroll.balance());

      const b = odds - 1; // decimal odds - 1
      const p = confidence / 100; // probability 0-1
      const q = 1 - p;
      
      let f = (b * p - q) / b; // Kelly fraction
      
      // Safety: Half-Kelly or Quarter-Kelly is often safer for sports. 
      // Let's use a conservative 1/4 Kelly to prevent ruin.
      f = f * 0.25; 
      
      if (f <= 0) {
          this.triggerToast("Podľa Kellyho kritéria nemá táto stávka hodnotu.", "error");
          return;
      }
      
      let suggested = Math.floor(bank * f);
      
      // Limits
      if (suggested < 1) suggested = 1;
      if (suggested > bank) suggested = bank;
      
      this.pendingBet.update(current => {
          if (!current) return null;
          return { 
              ...current, 
              stake: suggested, 
              return: Number((suggested * odds).toFixed(2)) 
          };
      });

      this.triggerToast(`Vklad optimalizovaný na €${suggested}`, "success");
  }

  updateStake(val: string | number) {
      const numVal = typeof val === 'string' ? parseFloat(val) : val;
      const bet = this.pendingBet();
      if(bet && !isNaN(numVal)) {
          this.pendingBet.update(b => b ? { ...b, stake: numVal, return: Number((numVal * b.odds).toFixed(2)) } : null);
      }
  }

  async confirmBet() {
      const bet = this.pendingBet();
      if (!bet || this.isProcessingBet()) return;
      
      this.isProcessingBet.set(true);
      
      // Simulate processing delay for "crafted" feel
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      const success = this.bankroll.placeBet(bet.description, bet.selection, bet.odds, bet.stake, bet.matchId);
      
      if (success) {
          this.betSuccess.set(true);
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Clear generator if it was an accumulator
          if (this.pendingBet()?.description === 'AI STRATEGY TICKET') {
              this.generatedTicket.set([]);
          }

          this.showBetModal.set(false);
          this.pendingBet.set(null);
          this.isProcessingBet.set(false);
          this.betSuccess.set(false);
          this.triggerToast('Tiket bol úspešne podaný!', 'success');
      } else {
          this.isProcessingBet.set(false);
          this.triggerToast('Nedostatok prostriedkov!', 'error');
      }
  }

  triggerToast(message: string, type: 'success' | 'error' = 'success') {
      this.toastMessage.set(message);
      this.toastType.set(type);
      this.showToast.set(true);
      setTimeout(() => {
          this.showToast.set(false);
      }, 4000);
  }

  cancelBet() {
      this.showBetModal.set(false);
      this.pendingBet.set(null);
  }

  placeBet(match: Match, selection: string, odds: number, event?: Event) {
    if (event) event.stopPropagation();
    this.initiateBet(`${match.home} vs ${match.away}`, selection, odds, this.currentStake(), undefined, match.id);
  }
  
  placeSpecificBet(match: Match, market: string, selection: string, odds: number) {
      this.initiateBet(`${match.home} vs ${match.away} (${market})`, selection, odds, this.currentStake(), undefined, match.id);
  }

  placeDailyTicket() {
    const preds = this.dailyTicketPredictions();
    const odds = this.dailyTicketTotalOdds();
    let stake = parseFloat(this.currentStake().toString());
    if (isNaN(stake) || stake <= 0) {
        alert("Vklad musí byť číslo väčšie ako 0!");
        return;
    }
    const details = preds.map(p => `${p.home} vs ${p.away} (${p.selectionName})`);
    this.initiateBet(`TIKET DŇA (${preds.length} zápasov)`, 'AKO', odds, stake, details);
  }

  placeAccumulator() {
    const ticket = this.generatedTicket();
    if (ticket.length === 0) return;
    const combinedOdds = this.getTotalOdds();
    let stake = parseFloat(this.currentStake().toString());
    if (isNaN(stake) || stake <= 0) {
        alert("Vklad musí byť číslo väčšie ako 0!");
        return;
    }
    const details = ticket.map(p => `${p.home} vs ${p.away} (${p.selectionName})`);
    this.initiateBet('AI STRATEGY TICKET', 'Multiple', combinedOdds, stake, details);
  }

  getTotalOdds(): number {
    const ticket = this.generatedTicket();
    if (ticket.length === 0) return 0;
    return ticket.reduce((acc, p) => acc * p.odds, 1);
  }
}