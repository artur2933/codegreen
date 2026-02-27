import { Injectable, signal, computed, effect } from '@angular/core';

export interface Bet {
  id: string;
  matchId?: string; // Added for result checking
  match: string;
  selection: string;
  odds: number;
  stake: number;
  status: 'pending' | 'won' | 'lost';
  timestamp: number;
}

interface AppState {
  balance: number;
  startBalance: number; 
  history: Bet[];
}

@Injectable({
  providedIn: 'root'
})
export class BankrollService {
  private readonly STORAGE_KEY = 'betpro_terminal_data_v1';

  // Core State
  private state = signal<AppState>({
    balance: 1000,
    startBalance: 1000,
    history: []
  });

  // Computed Public Props
  balance = computed(() => this.state().balance);
  allBets = computed(() => this.state().history);
  
  growthPercentage = computed(() => {
    const start = this.state().startBalance || 1; 
    const current = this.state().balance;
    const diff = current - start;
    return (diff / start) * 100;
  });
  
  activeBets = computed(() => this.allBets().filter(b => b.status === 'pending'));
  
  // Returns finished bets sorted by time (newest first)
  history = computed(() => 
    this.allBets()
      .filter(b => b.status !== 'pending')
      .sort((a, b) => b.timestamp - a.timestamp)
  );
  
  totalProfit = computed(() => {
    return this.history().reduce((acc, bet) => {
      if (bet.status === 'won') return acc + (bet.stake * bet.odds) - bet.stake;
      if (bet.status === 'lost') return acc - bet.stake;
      return acc;
    }, 0);
  });

  constructor() {
    this.loadState();
    
    // Auto-save
    effect(() => {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state()));
    });
  }

  private loadState() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.startBalance === undefined) parsed.startBalance = 1000;
        this.state.set(parsed);
      } catch (e) {
        console.error('Corrupt save data, resetting.');
      }
    }
  }

  updateBalance(newBalance: number) {
    this.state.update(s => ({
        ...s,
        balance: newBalance,
        startBalance: newBalance
    }));
  }

  placeBet(match: string, selection: string, odds: number, stake: number, matchId?: string): boolean {
    const currentBalance = parseFloat(this.state().balance.toString());
    const betStake = parseFloat(stake.toString());

    if (betStake > currentBalance) return false;

    const newBet: Bet = {
      id: Math.random().toString(36).substr(2, 9),
      matchId,
      match,
      selection,
      odds,
      stake: betStake,
      status: 'pending',
      timestamp: Date.now()
    };

    this.state.update(s => ({
      ...s,
      balance: s.balance - betStake,
      history: [newBet, ...s.history]
    }));
    
    return true;
  }

  resolveBet(id: string, isWin: boolean) {
    this.state.update(s => {
      const betIndex = s.history.findIndex(b => b.id === id);
      if (betIndex === -1) return s;

      // Ak už bola vyriešená, nerob nič
      if (s.history[betIndex].status !== 'pending') return s;

      const updatedHistory = [...s.history];
      const bet = { ...updatedHistory[betIndex], status: isWin ? 'won' : 'lost' } as Bet;
      updatedHistory[betIndex] = bet;

      let newBalance = s.balance;
      if (isWin) {
        newBalance += (bet.stake * bet.odds);
      }

      return {
        ...s,
        balance: newBalance,
        history: updatedHistory
      };
    });
  }

  resetBankroll() {
    this.state.update(s => ({ ...s, balance: 1000, startBalance: 1000, history: [] }));
  }

  reset() {
      this.resetBankroll();
  }
}