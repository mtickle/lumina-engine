import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({});

// Initialize Supabase admin client (Bypasses RLS)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;
const API_BIBLE_KEY = process.env.API_BIBLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !API_BIBLE_KEY) {
    console.error("❌ ERROR: Missing credentials in .env (Supabase or API.Bible).");
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration for Gemini
const MODEL_NAME = 'gemini-2.5-flash';

// --- API.BIBLE CONFIGURATION ---
const BIBLE_ID = '78a9f6124f344018-01'; // NIV
const CURATED_CHAPTERS = [
    'ROM.8', 'JHN.1', 'JHN.15', 'PSA.23', 'PSA.139', 'ISA.40', 'ISA.53',
    'EPH.2', 'PHI.4', 'COL.1', 'COL.3', 'HEB.11', '1JN.4', 'REV.21'
];

async function fetchRandomChapterText() {
    const randomChapterId = CURATED_CHAPTERS[Math.floor(Math.random() * CURATED_CHAPTERS.length)];
    console.log(`📖 Fetching raw text for chapter: ${randomChapterId} from API.Bible...`);

    try {
        const response = await fetch(`https://api.scripture.api.bible/v1/bibles/${BIBLE_ID}/chapters/${randomChapterId}?content-type=text`, {
            headers: { 'api-key': API_BIBLE_KEY }
        });

        if (!response.ok) throw new Error(`API.Bible Error: ${response.status}`);

        const data = await response.json();
        return {
            reference: data.data.reference,
            text: data.data.content
        };
    } catch (error) {
        console.error("❌ Failed to fetch from API.Bible:", error);
        return null;
    }
}

// --- UNSPLASH INTEGRATION ---
async function fetchUnsplashImage(keyword) {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;

    // Fallback if no key is provided
    if (!accessKey || accessKey === 'your_new_key_here') {
        console.warn("⚠️ UNSPLASH_ACCESS_KEY missing. Falling back to Picsum.");
        return `https://picsum.photos/seed/${encodeURIComponent(keyword)}/800/1200`;
    }

    try {
        const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=portrait&client_id=${accessKey}`;
        const res = await fetch(url);

        // Unsplash free tier is 50 requests/hour. Fallback smoothly if we hit the limit.
        if (!res.ok) {
            console.warn(`⚠️ Unsplash API limit/error (${res.status}). Falling back to Picsum.`);
            return `https://picsum.photos/seed/${encodeURIComponent(keyword)}/800/1200`;
        }

        const data = await res.json();
        // Append optimal sizing parameters to the raw URL
        const separator = data.urls.raw.includes('?') ? '&' : '?';
        return `${data.urls.raw}${separator}auto=format&fit=crop&w=800&q=80`;

    } catch (error) {
        console.error("❌ Failed to fetch from Unsplash:", error.message);
        return `https://picsum.photos/seed/${encodeURIComponent(keyword)}/800/1200`;
    }
}

// --- 1. JOB PROMPT TEMPLATES ---
const PROMPT_TEMPLATES = {
    PERSON: (existing) => `
        You are a strict, orthodox biblical historian. 
        Your task is to generate a feed card for a biblical PERSON.
        
        CRITICAL INSTRUCTIONS:
        - Ensure all historical and theological details are strictly factual according to the biblical text.
        - Avoid all extra-biblical revelations, apocryphal sources, and modern fringe interpretations.
        - DO NOT generate a card for any of the following figures: [${existing}]
        
        REQUIRED JSON SCHEMA:
        {
          "type": "PERSON",
          "metadataAnchor": "Name: Brief Title (e.g., Moses: The Exodus)",
          "payload": {
            "hookText": "A powerful, one-sentence hook (under 15 words).",
            "imageKeyword": "A single word for an Unsplash background image search (e.g., desert, ocean, crown).",
            "deepDive": "A 2-3 paragraph biography explaining their biblical significance."
          }
        }
    `,
    PLACE: (existing) => `
        You are a strict, orthodox biblical historian. 
        Your task is to generate a feed card for a biblical PLACE.
        
        CRITICAL INSTRUCTIONS:
        - Ensure all historical and theological details are strictly factual according to the biblical text.
        - DO NOT generate a card for any of the following places: [${existing}]
        
        REQUIRED JSON SCHEMA:
        {
          "type": "PLACE",
          "metadataAnchor": "Region or General Area (e.g., Jerusalem, First Century)",
          "payload": {
            "locationName": "Specific Name of the Place (e.g., The Temple Mount)",
            "description": "A 2-paragraph explanation of its historical and theological significance.",
            "imageKeyword": "A single word for an Unsplash background image search (e.g., ruins, river, mountain)."
          }
        }
    `,
    VERSE: (existing, rawTextData) => `
        You are a strict editorial curator for a biblical app.
        Your task is to select a highly impactful, standalone verse (or 2-3 short contiguous verses) from the provided raw text.
        
        RAW TEXT SOURCE (Chapter: ${rawTextData.reference}):
        """
        ${rawTextData.text}
        """
        
        REQUIRED JSON SCHEMA:
        {
          "type": "VERSE",
          "metadataAnchor": "Book Chapter:Verse(s) (e.g., Romans 8:28)",
          "payload": {
            "text": "The verbatim scripture text you selected.",
            "theme": "A Tailwind gradient class for the background (e.g., 'bg-gradient-to-br from-slate-900 to-slate-800' or 'bg-gradient-to-br from-blue-900 to-cyan-900')",
            "fontStyle": "font-serif"
          }
        }
    `,
    INSPIRATIONAL: (existing, rawTextData) => `
        You are a strict, orthodox devotional writer.
        Your task is to write a short, scripturally sound reflection based on a verse from the provided text.
        
        RAW TEXT SOURCE (Chapter: ${rawTextData.reference}):
        """
        ${rawTextData.text}
        """
        
        REQUIRED JSON SCHEMA:
        {
          "type": "INSPIRATIONAL",
          "metadataAnchor": "A 2-3 word theme (e.g., Daily Encouragement, Steadfast Hope)",
          "payload": {
            "quote": "A powerful, original 1-2 sentence reflection or conclusion drawn strictly from the provided text.",
            "imageKeyword": "A single word for an Unsplash background image search (e.g., sunrise, forest, path).",
            "deepDive": "A 2 paragraph orthodox reflection on the passage, explaining its meaning and application."
          }
        }
    `
};

// --- 2. MODULAR JOB RUNNER ---
async function runJob(jobType) {
    console.log(`\n🔍 Starting ${jobType} job...`);
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ ERROR: GEMINI_API_KEY is not set.");
        return;
    }

    const templateFn = PROMPT_TEMPLATES[jobType];

    console.log(`📚 Checking Supabase for existing ${jobType}s...`);
    const { data: existingCards } = await supabase
        .from('feed_cards')
        .select('metadata_anchor')
        .eq('card_type', jobType);

    const existingNames = existingCards && existingCards.length > 0
        ? existingCards.map(c => c.metadata_anchor).join(', ')
        : 'None generated yet';

    let rawTextData = null;
    if (jobType === 'VERSE' || jobType === 'INSPIRATIONAL') {
        rawTextData = await fetchRandomChapterText();
        if (!rawTextData) return;
    }

    const prompt = templateFn(existingNames, rawTextData);

    console.log(`🤖 Prompting ${MODEL_NAME}...`);

    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                temperature: 0.0,
                responseMimeType: "application/json"
            }
        });

        console.log(`✅ ${jobType} Generation complete!`);

        try {
            const parsedData = JSON.parse(response.text);
            const cardId = crypto.randomUUID();
            let finalPayload = { ...parsedData.payload };
            let extractedDeepDive = null;

            // Extract deep dive for relational database table
            if (parsedData.payload.deepDive) {
                extractedDeepDive = parsedData.payload.deepDive;
                delete finalPayload.deepDive;
                finalPayload.hasDeepDive = true;
            }

            // Fetch real image from Unsplash
            if (finalPayload.imageKeyword) {
                console.log(`📸 Fetching Unsplash image for: "${finalPayload.imageKeyword}"`);
                const fetchedUrl = await fetchUnsplashImage(finalPayload.imageKeyword);

                // Map the URL to the correct frontend prop based on card type
                if (jobType === 'PLACE') {
                    finalPayload.mapImageUrl = fetchedUrl;
                } else if (jobType === 'INSPIRATIONAL') {
                    finalPayload.bgUrl = fetchedUrl;
                } else {
                    finalPayload.imageUrl = fetchedUrl;
                }
            }

            console.log(`☁️ Pushing ${parsedData.metadataAnchor} to Supabase...`);

            const { error: cardError } = await supabase
                .from('feed_cards')
                .insert({
                    id: cardId,
                    card_type: parsedData.type,
                    metadata_anchor: parsedData.metadataAnchor,
                    active: true,
                    payload: finalPayload
                });

            if (cardError) throw new Error(`Feed Card Insert Failed: ${cardError.message}`);

            if (extractedDeepDive) {
                const { error: deepDiveError } = await supabase
                    .from('deep_dives')
                    .insert({
                        card_id: cardId,
                        content_markdown: extractedDeepDive
                    });

                if (deepDiveError) throw new Error(`Deep Dive Insert Failed: ${deepDiveError.message}`);
            }

            console.log(`🎉 Success! ${parsedData.metadataAnchor} added to database!\n`);

        } catch (dbOrParseError) {
            console.error("❌ ERROR during formatting or database insert:", dbOrParseError);
        }

    } catch (error) {
        console.error("❌ ERROR generating content:", error);
    }
}

// --- 3. EXECUTION ---
const args = process.argv.slice(2);
const validJobs = ['PERSON', 'PLACE', 'VERSE', 'INSPIRATIONAL'];

if (args.includes('--PERSON')) runJob('PERSON');
else if (args.includes('--PLACE')) runJob('PLACE');
else if (args.includes('--VERSE')) runJob('VERSE');
else if (args.includes('--INSPIRATIONAL')) runJob('INSPIRATIONAL');
else if (args.includes('--RANDOM')) {
    const randomJob = validJobs[Math.floor(Math.random() * validJobs.length)];
    console.log(`🎲 Picked: ${randomJob}`);
    runJob(randomJob);
} else {
    console.log(`❌ No valid flag provided. Try --PERSON, --PLACE, --VERSE, or --INSPIRATIONAL`);
}