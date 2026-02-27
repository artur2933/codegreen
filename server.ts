import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';
import NodeCache from 'node-cache';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000; // Hardcoded as per environment instructions

// Enable trust proxy for Cloud Run / Reverse Proxies
app.set('trust proxy', 1);

// --- SECURITY & PERFORMANCE ---

// 1. Rate Limiting (Prevent Abuse)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false } // Disable validation warning as we trust proxy
});

// 2. Caching (Save API Costs & Speed Up)
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour by default

app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter); // Apply rate limiting to API routes

// API Keys
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SPORTS_API_KEY = process.env.API_FOOTBALL_KEY;
const WHOP_API_KEY = process.env.WHOP_API_KEY; // Future: Real Whop Integration

// Initialize Gemini
let aiClient: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

// --- MIDDLEWARE: WHOP LICENSE CHECK (MOCK FOR NOW) ---
// In production, this would verify the license key with Whop API
const checkLicense = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const licenseKey = req.headers['x-license-key'];
    
    // For development/demo, we allow requests without a key or with a dummy key
    // In production, uncomment the check below
    /*
    if (!licenseKey || licenseKey !== 'valid-license') {
        return res.status(403).json({ error: 'Invalid or missing license key. Please purchase a subscription.' });
    }
    */
    next();
};

// --- API Routes ---

// 0. Validate License (Called by Frontend Login)
app.post('/api/validate-license', (req, res) => {
    const { key } = req.body;
    
    // MOCK VALIDATION LOGIC
    // In production, call Whop API: https://api.whop.com/api/v2/memberships/validate_license
    
    if (!key) {
        return res.status(400).json({ valid: false, message: 'License key is required' });
    }

    // Accept specific patterns for demo
    const isValid = key.startsWith('WHOP-') || key === 'DEV-PRO' || key === 'DEMO-123';
    
    if (isValid) {
        return res.json({ 
            valid: true, 
            plan: 'PRO ACCESS',
            user: { id: 'user_123', name: 'Demo User' }
        });
    } else {
        return res.status(403).json({ 
            valid: false, 
            message: 'Invalid license key' 
        });
    }
});

// 1. Get Matches (Proxy to Sports API with Caching)
app.get('/api/matches', checkLicense, async (req, res) => {
    const league = req.query.league as string;
    if (!league) {
        return res.status(400).json({ error: 'League is required' });
    }

    const cacheKey = `matches_${league}`;
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
        console.log(`Serving matches for ${league} from CACHE`);
        return res.json(cachedData);
    }

    // Mock Data Fallback if no key
    if (!SPORTS_API_KEY) {
        console.warn('No Sports API Key, returning mock data');
        return res.json({ mock: true, data: [] }); // Client handles mock generation
    }

    try {
        const LEAGUE_IDS: Record<string, number> = {
            'PL': 39, 'PD': 140, 'BL1': 78, 'SA': 135, 'L1': 61,
            'ERE': 88, 'PPL': 94, 'UCL': 2, 'UEL': 3
        };
        const leagueId = LEAGUE_IDS[league];
        if (!leagueId) return res.json([]);

        const currentYear = new Date().getFullYear();
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?league=${leagueId}&season=${currentYear}&next=5`, {
            headers: {
                'x-rapidapi-host': 'v3.football.api-sports.io',
                'x-rapidapi-key': SPORTS_API_KEY
            }
        });

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const data = await response.json();
        
        // Cache the successful response
        cache.set(cacheKey, data, 3600); // Cache for 1 hour
        res.json(data);
    } catch (error) {
        console.error('Sports API Error:', error);
        res.status(500).json({ error: 'Failed to fetch matches' });
    }
});

// 1.5 Get Match Status (Real Result Checking)
app.get('/api/match-status', checkLicense, async (req, res) => {
    const matchId = req.query.id as string;
    if (!matchId) return res.status(400).json({ error: 'Match ID required' });

    // Check if it's a mock match
    if (matchId.startsWith('mock-')) {
        return res.json({ 
            mock: true, 
            status: 'FT', 
            score: { home: Math.floor(Math.random() * 4), away: Math.floor(Math.random() * 3) } 
        });
    }

    const cacheKey = `status_${matchId}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    if (!SPORTS_API_KEY) return res.json({ mock: true, status: 'FT', score: { home: 1, away: 0 } });

    try {
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?id=${matchId}`, {
            headers: {
                'x-rapidapi-host': 'v3.football.api-sports.io',
                'x-rapidapi-key': SPORTS_API_KEY
            }
        });

        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const data = await response.json();
        
        if (data.response && data.response.length > 0) {
            const fixture = data.response[0];
            const result = {
                status: fixture.fixture.status.short, // FT, NS, 1H, etc.
                score: fixture.goals, // { home: 2, away: 1 }
                elapsed: fixture.fixture.status.elapsed
            };
            
            // Cache short term (1 min) for live scores, longer for FT
            const ttl = result.status === 'FT' ? 3600 : 60;
            cache.set(cacheKey, result, ttl);
            res.json(result);
        } else {
            res.status(404).json({ error: 'Match not found' });
        }
    } catch (error) {
        console.error('Match Status Error:', error);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// 2. Analyze Match (Gemini with Caching)
app.post('/api/analyze', checkLicense, async (req, res) => {
    if (!aiClient) {
        return res.status(503).json({ error: 'AI Service Unavailable' });
    }

    const { match } = req.body;
    if (!match) return res.status(400).json({ error: 'Match data required' });

    const cacheKey = `analysis_${match.id}`;
    const cachedAnalysis = cache.get(cacheKey);

    if (cachedAnalysis) {
        console.log(`Serving analysis for ${match.id} from CACHE`);
        return res.json({ analysis: cachedAnalysis });
    }

    const prompt = `
      Analyze: ${match.home} (Rank ${match.stats.home.rank}, Form ${match.stats.home.form}) vs ${match.away} (Rank ${match.stats.away.rank}, Form ${match.stats.away.form}).
      Key injuries: ${match.stats.home.injuries.join(',')} / ${match.stats.away.injuries.join(',')}.
      Odds: ${match.odds.home} - ${match.odds.draw} - ${match.odds.away}.
      Constraint: Write EXACTLY 2 sentences. Be direct, critical, and data-driven. State the most likely outcome clearly. No fluff.
    `;

    try {
        const response = await aiClient.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        
        const analysisText = response.text;
        cache.set(cacheKey, analysisText, 86400); // Cache for 24 hours (match analysis rarely changes drastically)
        res.json({ analysis: analysisText });
    } catch (error) {
        console.error('Gemini Analysis Error:', error);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

// 3. Generate Ticket (Gemini with Caching)
app.post('/api/generate-ticket', checkLicense, async (req, res) => {
    if (!aiClient) {
        return res.status(503).json({ error: 'AI Service Unavailable' });
    }
    
    const { league } = req.body;
    const today = new Date().toLocaleDateString('en-GB');
    const cacheKey = `ticket_${league}_${today}`;
    
    const cachedTicket = cache.get(cacheKey);
    if (cachedTicket) {
        console.log(`Serving ticket for ${league} from CACHE`);
        return res.json(cachedTicket);
    }
    
    const prompt = `
      Task: Find REAL scheduled football matches for ${league} taking place TODAY (${today}) OR the next upcoming matchday.
      1. Use Google Search to find the official schedule.
      2. Prioritize matches for TODAY.
      3. Output JSON array of match objects.
      
      Output Format:
      [
        {
          "id": "unique_string",
          "home": "Team", "away": "Team", "league": "${league}",
          "time": "HH:MM",
          "recommendedBet": "1",
          "odds": { "home": 1.5, "draw": 3.5, "away": 4.5, "over25": 1.8, "under25": 2.0, "bttsYes": 1.7, "bttsNo": 2.1, "htHome": 2.0, "htDraw": 2.2, "htAway": 5.0 },
          "stats": {
             "home": { "rank": 1, "points": 10, "form": "WWWWW", "goalsFor": 10, "goalsAgainst": 2, "goalsPerGame": 2.5, "possession": 60, "shotsOnTarget": 5, "shotsTotal": 10, "xG": 1.5, "corners": 5, "fouls": 10, "yellowCards": 1, "redCards": 0, "offsides": 1, "saves": 2, "cleanSheets": 3, "injuries": [] },
             "away": { "rank": 2, "points": 8, "form": "WWWDW", "goalsFor": 8, "goalsAgainst": 3, "goalsPerGame": 2.0, "possession": 40, "shotsOnTarget": 4, "shotsTotal": 8, "xG": 1.2, "corners": 4, "fouls": 12, "yellowCards": 2, "redCards": 0, "offsides": 2, "saves": 3, "cleanSheets": 2, "injuries": [] }
          }
        }
      ]
      RETURN ONLY JSON.
    `;

    try {
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: 'application/json'
            }
        });
        
        const text = response.text || "[]";
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const ticketData = JSON.parse(cleanText);
        
        cache.set(cacheKey, ticketData, 3600); // Cache for 1 hour
        res.json(ticketData);
    } catch (error) {
        console.error('Gemini Ticket Error:', error);
        res.status(500).json({ error: 'Generation failed' });
    }
});

// Serve Static Files
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Fallback to Index
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
