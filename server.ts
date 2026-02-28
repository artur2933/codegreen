import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';
import NodeCache from 'node-cache';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Initialize Sentry for Error Tracking & Performance Monitoring
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0, // Capture 100% of the transactions
  profilesSampleRate: 1.0, // Profile 100% of the transactions
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000; // Hardcoded as per environment instructions

// Enable trust proxy for Cloud Run / Reverse Proxies
app.set('trust proxy', 1);

// --- SECURITY & PERFORMANCE ---

// 1. Rate Limiting (Prevent Abuse)
// Using Vercel KV for distributed rate limiting across serverless functions
const apiLimiter = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const key = `rate_limit_${ip}`;
    
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
            const current = await kv.incr(key);
            if (current === 1) {
                await kv.expire(key, 900); // 15 minutes
            }
            if (current > 100) {
                return res.status(429).json({ error: 'Too many requests, please try again later.' });
            }
        } catch (e) {
            console.warn('KV Rate Limit error, bypassing', e);
        }
    }
    next();
};

import { kv } from '@vercel/kv';

// 2. Caching (Save API Costs & Speed Up)
const localCache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour by default

const cache = {
    get: async (key: string) => {
        if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            try {
                return await kv.get(key);
            } catch (e) {
                console.warn('Vercel KV get error, falling back to local cache', e);
            }
        }
        return localCache.get(key);
    },
    set: async (key: string, value: any, ttlSeconds: number = 3600) => {
        if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
            try {
                await kv.set(key, value, { ex: ttlSeconds });
                return;
            } catch (e) {
                console.warn('Vercel KV set error, falling back to local cache', e);
            }
        }
        localCache.set(key, value, ttlSeconds);
    }
};

app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter); // Apply rate limiting to API routes

// API Keys
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (GEMINI_API_KEY === 'undefined' || GEMINI_API_KEY === 'null') {
    GEMINI_API_KEY = undefined;
}
const SPORTS_API_KEY = process.env.API_FOOTBALL_KEY;
const WHOP_API_KEY = process.env.WHOP_API_KEY; // Future: Real Whop Integration

// Initialize Gemini
function getAiClient(): GoogleGenAI | null {
    let key = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (key === 'undefined' || key === 'null') key = undefined;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
}

// --- MIDDLEWARE: WHOP LICENSE CHECK (MOCK FOR NOW) ---
// In production, this would verify the license key with Whop API
// --- LICENSE VALIDATION LOGIC ---
async function validateLicenseKey(key: string): Promise<boolean> {
    if (!key) return false;
    
    // 1. Check Whop API if configured
    if (process.env.WHOP_API_KEY) {
        try {
            const response = await fetch(`https://api.whop.com/api/v2/memberships/${key}/validate_license`, {
                headers: {
                    'Authorization': `Bearer ${process.env.WHOP_API_KEY}`,
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                return data.valid === true;
            }
            return false;
        } catch (e) {
            console.error('Whop API Validation Error:', e);
            return false;
        }
    }
    
    // 2. Fallback to mock logic (for development/demo)
    return key.startsWith('WHOP-') || key === 'DEV-PRO' || key === 'DEMO-123';
}

const checkLicense = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const licenseKey = req.headers['x-license-key'] as string;
    
    if (!licenseKey) {
        return res.status(403).json({ error: 'Missing license key. Please purchase a subscription.' });
    }

    // Cache the validation result for 5 minutes to avoid spamming Whop API
    const cacheKey = `license_valid_${licenseKey}`;
    let isValid = await cache.get(cacheKey);
    
    if (isValid === undefined || isValid === null) {
        isValid = await validateLicenseKey(licenseKey);
        await cache.set(cacheKey, isValid, 300); // 5 minutes
    }

    if (!isValid) {
        return res.status(403).json({ error: 'Invalid or expired license key.' });
    }

    next();
};

// --- API Routes ---

// 0. Validate License (Called by Frontend Login)
app.post('/api/validate-license', async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
        return res.status(400).json({ valid: false, message: 'License key is required' });
    }

    const isValid = await validateLicenseKey(key);
    
    if (isValid) {
        return res.json({ 
            valid: true, 
            plan: 'PRO ACCESS',
            user: { id: 'user_123', name: 'Premium User' }
        });
    } else {
        return res.status(403).json({ 
            valid: false, 
            message: 'Invalid or expired license key' 
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
    const cachedData = await cache.get(cacheKey);

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
        await cache.set(cacheKey, data, 3600); // Cache for 1 hour
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
    const cachedData = await cache.get(cacheKey);
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
            await cache.set(cacheKey, result, ttl);
            res.json(result);
        } else {
            res.status(404).json({ error: 'Match not found' });
        }
    } catch (error) {
        console.error('Match Status Error:', error);
        res.status(500).json({ error: 'Failed to fetch status' });
    }
});

// 1.6 Get League Standings (Football-Data.org)
app.get('/api/standings', checkLicense, async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: 'League code required' });

    const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
    if (!FOOTBALL_DATA_API_KEY) return res.json(null);

    const cacheKey = `standings_${code}`;
    const cachedData = await cache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        const response = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings`, {
            headers: { 'X-Auth-Token': FOOTBALL_DATA_API_KEY }
        });
        if (!response.ok) throw new Error('Football-Data API Error');
        const data = await response.json();
        await cache.set(cacheKey, data, 3600 * 12); // Cache for 12 hours
        res.json(data);
    } catch (error) {
        console.error('Standings Error:', error);
        res.status(500).json({ error: 'Failed to fetch standings' });
    }
});

// 1.7 Get Advanced Stats (Sportmonks)
app.get('/api/advanced-stats', checkLicense, async (req, res) => {
    const matchId = req.query.matchId as string;
    if (!matchId) return res.status(400).json({ error: 'Match ID required' });

    const SPORTMONKS_API_KEY = process.env.SPORTMONKS_API_KEY;
    if (!SPORTMONKS_API_KEY) return res.json(null);

    const cacheKey = `sportmonks_${matchId}`;
    const cachedData = await cache.get(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        const response = await fetch(`https://api.sportmonks.com/v3/football/fixtures/${matchId}?include=statistics;expectedGoals`, {
            headers: { 'Authorization': SPORTMONKS_API_KEY }
        });
        if (!response.ok) throw new Error('Sportmonks API Error');
        const data = await response.json();
        await cache.set(cacheKey, data.data, 3600 * 24); // Cache for 24 hours
        res.json(data.data);
    } catch (error) {
        console.error('Sportmonks Error:', error);
        res.status(500).json({ error: 'Failed to fetch advanced stats' });
    }
});

// 2. Analyze Match (Gemini with Caching)
app.post('/api/analyze', checkLicense, async (req, res) => {
    const aiClient = getAiClient();
    if (!aiClient) {
        return res.status(503).json({ error: 'AI Service Unavailable' });
    }

    // Rate Limiting Logic for Analysis
    const licenseKey = req.headers['x-license-key'] as string;
    const todayStr = new Date().toISOString().split('T')[0];
    const rateLimitKey = `rate_limit_analyze_${licenseKey}_${todayStr}`;
    
    const currentUsage = (await cache.get(rateLimitKey)) as number || 0;
    const MAX_ANALYSES_PER_DAY = 20;
    
    if (currentUsage >= MAX_ANALYSES_PER_DAY) {
        return res.status(429).json({ error: `Denný limit analýz vyčerpaný (${MAX_ANALYSES_PER_DAY}/${MAX_ANALYSES_PER_DAY}).` });
    }

    const { match } = req.body;
    if (!match) return res.status(400).json({ error: 'Match data required' });

    const cacheKey = `analysis_${match.id}`;
    const cachedAnalysis = await cache.get(cacheKey);

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
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });
        
        const analysisText = response.text;
        await cache.set(cacheKey, analysisText, 86400); // Cache for 24 hours (match analysis rarely changes drastically)
        
        // Increment rate limit usage
        await cache.set(rateLimitKey, currentUsage + 1, 86400); // 24 hours
        
        res.json({ analysis: analysisText });
    } catch (error: any) {
        const errorStr = error.message || JSON.stringify(error);
        if (errorStr.includes('API key not valid') || errorStr.includes('API_KEY_INVALID')) {
            console.warn('Gemini API Key is invalid. Returning fallback data.');
            return res.status(503).json({ error: 'AI Service Unavailable (Invalid API Key)' });
        }
        console.error('Gemini Analysis Error:', error);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

// 3. Generate Ticket (Gemini with Caching)
app.post('/api/generate-ticket', checkLicense, async (req, res) => {
    const aiClient = getAiClient();
    if (!aiClient) {
        return res.status(503).json({ error: 'AI Service Unavailable' });
    }
    
    // Rate Limiting Logic
    const licenseKey = req.headers['x-license-key'] as string;
    const todayStr = new Date().toISOString().split('T')[0];
    const rateLimitKey = `rate_limit_ticket_${licenseKey}_${todayStr}`;
    
    const currentUsage = (await cache.get(rateLimitKey)) as number || 0;
    const MAX_TICKETS_PER_DAY = 5;
    
    if (currentUsage >= MAX_TICKETS_PER_DAY) {
        return res.status(429).json({ error: `Daily limit reached (${MAX_TICKETS_PER_DAY}/${MAX_TICKETS_PER_DAY} tickets). Please try again tomorrow.` });
    }

    const { league, risk, matches } = req.body;
    
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
        return res.status(400).json({ error: 'Matches data required for analysis' });
    }

    const today = new Date().toLocaleDateString('en-GB');
    const cacheKey = `ticket_${league}_${risk}_${today}`;
    
    const cachedTicket = await cache.get(cacheKey);
    if (cachedTicket) {
        console.log(`Serving ticket for ${league} (${risk}) from CACHE`);
        return res.json(cachedTicket);
    }
    
    // Simplify matches payload to save tokens
    const simplifiedMatches = matches.map(m => ({
        id: m.id,
        home: m.home,
        away: m.away,
        odds: m.odds,
        stats: {
            home: { rank: m.stats.home.rank, form: m.stats.home.form, xG: m.stats.home.xG },
            away: { rank: m.stats.away.rank, form: m.stats.away.form, xG: m.stats.away.xG }
        }
    }));

    const prompt = `
      You are an expert sports betting AI. I am providing you with a list of REAL upcoming football matches, including their odds and basic team stats.
      Your task is to select the BEST 3 betting opportunities for a ${risk === 'high' ? 'HIGH' : 'LOW'} risk strategy.
      - Low risk: Focus on high probability outcomes (odds typically 1.20 - 1.60).
      - High risk: Focus on value bets with higher returns (odds typically 1.80 - 3.00).
      
      Matches Data:
      ${JSON.stringify(simplifiedMatches)}
      
      Select exactly 3 bets.
      Return ONLY a valid JSON array of objects with this exact structure:
      [
        {
          "matchId": "string (must match the provided id)",
          "marketName": "Víťaz" | "Góly" | "BTTS",
          "selectionName": "Home Team Name" | "Away Team Name" | "Remíza" | "Nad 2.5" | "Pod 2.5" | "Áno" | "Nie",
          "odds": 1.5,
          "reasoning": "Short 1-sentence explanation based on the provided stats."
        }
      ]
      Do NOT wrap the response in markdown blocks like \`\`\`json. Return raw JSON only.
    `;

    try {
        const response = await aiClient.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                responseMimeType: 'application/json'
            }
        });
        
        let text = response.text || "[]";
        // Remove markdown formatting if the model still returns it despite responseMimeType
        text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        
        let ticketData;
        try {
            ticketData = JSON.parse(text);
        } catch (parseError) {
            console.error('Failed to parse Gemini response as JSON:', text);
            throw new Error('Invalid JSON response from AI');
        }
        
        await cache.set(cacheKey, ticketData, 3600); // Cache for 1 hour
        
        // Increment rate limit usage
        await cache.set(rateLimitKey, currentUsage + 1, 86400); // 24 hours
        
        res.json(ticketData);
    } catch (error: any) {
        const errorStr = error.message || JSON.stringify(error);
        if (errorStr.includes('API key not valid') || errorStr.includes('API_KEY_INVALID')) {
            console.warn('Gemini API Key is invalid. Returning fallback data.');
            return res.status(503).json({ error: 'AI Service Unavailable (Invalid API Key)' });
        }
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
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    import('fs').then(fs => {
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(503).send('Application is building. Please refresh in a few seconds.');
        }
    });
});

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

export default app;
