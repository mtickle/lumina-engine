import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({});

// Initialize Supabase admin client (Bypasses RLS)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;
const API_BIBLE_KEY = process.env.API_BIBLE_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !API_BIBLE_KEY || !PEXELS_API_KEY) {
    console.error("❌ ERROR: Missing credentials in .env (Supabase, API.Bible, or Pexels).");
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration for Gemini
const MODEL_NAME = 'gemini-3.5-flash';

// *** API.BIBLE CONFIGURATION ***
const BIBLE_ID = '78a9f6124f344018-01'; // NIV
const CURATED_CHAPTERS = [
    // Your Originals
    'ROM.8', 'JHN.1', 'JHN.15', 'PSA.23', 'PSA.139', 'ISA.40', 'ISA.53',
    'EPH.2', 'PHP.4', 'COL.1', 'COL.3', 'HEB.11', '1JN.4', 'REV.21',

    // The Torah & Historical Epics (Creation, Exodus, Heroes)
    'GEN.1', 'GEN.2', 'GEN.12', 'GEN.15', 'EXO.3', 'EXO.14', 'EXO.20', 'JOS.1', 'RUT.1', '1SA.17', 'NEH.8',

    // Wisdom & Poetry (Prime for Inspirational & Verse cards)
    'PSA.1', 'PSA.8', 'PSA.16', 'PSA.19', 'PSA.27', 'PSA.32', 'PSA.34', 'PSA.42', 'PSA.46', 'PSA.51', 
    'PSA.63', 'PSA.84', 'PSA.90', 'PSA.91', 'PSA.100', 'PSA.103', 'PSA.121', 'PRO.3', 'PRO.8', 'ECC.3',

    // The Prophets (Messianic Prophecy & Steadfast Hope)
    'ISA.6', 'ISA.9', 'ISA.43', 'ISA.55', 'ISA.61', 'JER.29', 'LAM.3', 'EZK.37', 'DAN.3', 'DAN.6',

    // The Gospels (Jesus' Life, Parables & Teachings)
    'MAT.5', 'MAT.6', 'MAT.7', 'MAT.28', 'MRK.4', 'LUK.1', 'LUK.2', 'LUK.15', 'JHN.3', 'JHN.4', 
    'JHN.10', 'JHN.14', 'JHN.17', 'JHN.20',

    // Acts & The Early Church
    'ACT.2', 'ACT.9', 'ACT.17',

    // The Epistles (Theology, Love, & Christian Living)
    'ROM.5', 'ROM.12', '1CO.13', '1CO.15', '2CO.4', '2CO.5', 'GAL.5', 'EPH.1', 'EPH.6', 'PHP.2', 
    '1TH.4', 'HEB.4', 'HEB.12', 'JAS.1', 'JAS.3', '1PE.1', '1JN.1', '1JN.3',

    // Revelation (The Consummation & Glory)
    'REV.1', 'REV.4', 'REV.5', 'REV.22'
];

async function fetchRandomChapterText() {
    const randomChapterId = CURATED_CHAPTERS[Math.floor(Math.random() * CURATED_CHAPTERS.length)];
    console.log(`📖 Fetching raw text for chapter: ${randomChapterId} from API.Bible...`);

    try {
        const response = await fetch(`https://rest.api.bible/v1/bibles/${BIBLE_ID}/chapters/${randomChapterId}?content-type=text`, {
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

// *** IMAGE GENERATION VIA PEXELS ***
async function getImageUrl(searchQuery) {
    if (!searchQuery) return 'https://picsum.photos/seed/lumina/1080/1920'; // Fallback

    console.log(`📸 Searching Pexels for: "${searchQuery}"`);

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&orientation=portrait&per_page=1`, {
            headers: {
                Authorization: PEXELS_API_KEY
            }
        });

        if (!response.ok) throw new Error(`Pexels Error: ${response.status}`);

        const data = await response.json();

        if (data.photos && data.photos.length > 0) {
            // 'large2x' provides high-resolution imagery ideal for mobile displays
            return data.photos[0].src.large2x;
        }

        console.log(`⚠️ No Pexels results for "${searchQuery}", using fallback.`);
        return 'https://picsum.photos/seed/lumina/1080/1920';

    } catch (error) {
        console.error("❌ Failed to fetch from Pexels:", error);
        return 'https://picsum.photos/seed/lumina/1080/1920';
    }
}

// *** GEMINI API RETRY WRAPPER ***
async function generateWithRetry(prompt, maxRetries = 3, delayMs = 5000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await ai.models.generateContent({
                model: MODEL_NAME,
                contents: prompt,
                config: {
                    temperature: 0.0,
                    responseMimeType: "application/json"
                }
            });
        } catch (error) {
            // If it is the last retry, or NOT a 503/429 error, throw it so the script catches it
            if (i === maxRetries - 1 || (error.status !== 503 && error.status !== 429)) {
                throw error;
            }
            console.log(`⚠️ API busy. Retrying in ${delayMs / 1000} seconds (Attempt ${i + 1} of ${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

// *** 1. JOB PROMPT TEMPLATES ***
const PROMPT_TEMPLATES = {
    PERSON: (existing) => `
        You are a strict, orthodox biblical historian. 
        Your task is to generate a feed card for a biblical PERSON.
        
        CRITICAL INSTRUCTIONS:
        * Ensure all historical and theological details are strictly factual according to the biblical text.
        * Avoid all extra-biblical revelations, apocryphal sources, and modern fringe interpretations.
        * DO NOT generate a card for any of the following figures: [${existing}]
        
        REQUIRED JSON SCHEMA:
        {
          "type": "PERSON",
          "metadataAnchor": "Name: Brief Title (e.g., Moses: The Exodus)",
          "payload": {
            "hookText": "A powerful, one-sentence hook (under 15 words).",
            "imageQuery": "A 2-3 word search query for a stock photo API. MUST describe a timeless nature scene, weather, or ancient macro texture. STRICTLY PROHIBITED: Do not use words like war, battle, weapon, farmer, people, modern, or proper nouns (like Israel). Example safe queries: 'desert wind', 'ancient stone walls', 'gathering storm clouds', 'olive tree branch'.",
            "deepDive": "A 2-3 paragraph biography explaining their biblical significance."
          }
        }
    `,
    PLACE: (existing) => `
        You are a strict, orthodox biblical historian. 
        Your task is to generate a feed card for a biblical PLACE.
        
        CRITICAL INSTRUCTIONS:
        * Ensure all historical and theological details are strictly factual according to the biblical text.
        * DO NOT generate a card for any of the following places: [${existing}]
        
        REQUIRED JSON SCHEMA:
        {
          "type": "PLACE",
          "metadataAnchor": "Region or General Area (e.g., Jerusalem, First Century)",
          "payload": {
            "locationName": "Specific Name of the Place (e.g., The Temple Mount)",
            "description": "A 2-paragraph explanation of its historical and theological significance.",
            "imageQuery": "A 2-3 word search query for a stock photo API. MUST describe a timeless nature scene, weather, or ancient macro texture. STRICTLY PROHIBITED: Do not use words like war, battle, weapon, farmer, people, modern, or proper nouns (like Israel). Example safe queries: 'arid desert landscape', 'ancient stone ruins', 'calm sea horizon', 'dusty dirt path'."
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
            "imageQuery": "A 2-3 word search query for a stock photo API. MUST describe a timeless nature scene, weather, or macro texture. STRICTLY PROHIBITED: Do not use words like war, battle, weapon, farmer, people, modern, or proper nouns. Example safe queries: 'morning sunlight window', 'calm ocean waves', 'forest path sunrise', 'still water'.",
            "text": "The verbatim scripture text you selected.",
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
            "imageQuery": "A 2-3 word search query for a stock photo API. MUST describe a timeless nature scene, weather, or macro texture. STRICTLY PROHIBITED: Do not use words like war, battle, weapon, farmer, people, modern, or proper nouns. Example safe queries: 'morning sunlight window', 'calm ocean waves', 'forest path sunrise', 'still water'.",
            "deepDive": "A 2 paragraph orthodox reflection on the passage, explaining its meaning and application."
          }
        }
    `
};

// *** 2. MODULAR JOB RUNNER ***
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
        // We replaced the direct call with our new retry wrapper here
        const response = await generateWithRetry(prompt);

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

            // Await the new async Pexels image generation
            if (finalPayload.imageQuery) {
                const fetchedUrl = await getImageUrl(finalPayload.imageQuery);

                // Map the URL to the correct frontend prop based on card type
                if (jobType === 'PLACE') {
                    finalPayload.mapImageUrl = fetchedUrl;
                } else if (jobType === 'INSPIRATIONAL') {
                    finalPayload.bgUrl = fetchedUrl;
                } else {
                    finalPayload.imageUrl = fetchedUrl;
                }

                // Remove the raw query string from the payload
                delete finalPayload.imageQuery;
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

// *** 3. EXECUTION ***
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