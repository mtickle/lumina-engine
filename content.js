import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

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

// Configuration for Gemini 2.5 Flash
const MODEL_NAME = 'gemini-2.5-flash';

// --- API.BIBLE CONFIGURATION ---
// The exact ID for the New International Version (NIV)
const BIBLE_ID = '78a9f6124f344018-01'; 

// A curated list of books/chapters rich with potential verses and inspiration
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
            text: data.data.content // This is the raw string of the chapter text
        };
    } catch (error) {
        console.error("❌ Failed to fetch from API.Bible:", error);
        return null;
    }
}

// --- 1. JOB PROMPT TEMPLATES ---
const PROMPT_TEMPLATES = {
    PERSON: (existing) => `
        You are a strict, orthodox biblical historian. 
        Your task is to generate a feed card for a biblical PERSON.
        
        CRITICAL INSTRUCTIONS:
        - Ensure all historical and theological details are strictly factual according to the biblical text.
        - Avoid all extra-biblical revelations, apocryphal sources, and modern fringe interpretations (e.g., NAR).
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
        - Avoid all extra-biblical revelations, apocryphal sources, and modern fringe interpretations.
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
        
        CRITICAL INSTRUCTIONS:
        - Output ONLY valid JSON.
        - The selected text MUST be a verbatim quote from the provided text block. Do not alter the translation.
        - DO NOT generate a card for any of the following references: [${existing}]
        
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
        
        CRITICAL INSTRUCTIONS:
        - Output ONLY valid JSON.
        - Keep the theology historically orthodox. AVOID prosperity gospel, NAR, or man-centered pop-psychology. Focus on God's character, grace, and truth.
        - DO NOT generate a card for any of the following references: [${existing}]
        
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
            "bgUrl": "A placeholder image URL from Unsplash (e.g., https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=800&h=1200)",
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
    if (!templateFn) {
        console.error(`❌ ERROR: Invalid job type: ${jobType}`);
        return;
    }

    // 1. Check existing records to prevent duplicates
    console.log(`📚 Checking Supabase for existing ${jobType}s...`);
    const { data: existingCards, error: fetchError } = await supabase
        .from('feed_cards')
        .select('metadata_anchor')
        .eq('card_type', jobType);

    if (fetchError) {
        console.error('❌ Failed to fetch existing cards:', fetchError.message);
        return;
    }

    const existingNames = existingCards && existingCards.length > 0 
        ? existingCards.map(c => c.metadata_anchor).join(', ')
        : 'None generated yet';

    console.log(`🧠 Instructing model to avoid: ${existingNames}`);
    
    // If the job requires scripture text, fetch it first
    let rawTextData = null;
    if (jobType === 'VERSE' || jobType === 'INSPIRATIONAL') {
        rawTextData = await fetchRandomChapterText();
        if (!rawTextData) {
            console.error("❌ Aborting job: Could not fetch raw scripture text.");
            return;
        }
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
            console.log(`\n☁️ Pushing ${parsedData.metadataAnchor} to Supabase...`);
            
            const cardId = crypto.randomUUID();
            let finalPayload = { ...parsedData.payload };
            let extractedDeepDive = null;

            // Extract the deep dive text if it exists so we can store it relationally
            if (parsedData.payload.deepDive) {
                extractedDeepDive = parsedData.payload.deepDive;
                delete finalPayload.deepDive;
                finalPayload.hasDeepDive = true; // Tell the frontend it exists
            }

            // Construct Unsplash URL from keyword (for PERSON/PLACE)
            if (finalPayload.imageKeyword) {
                finalPayload.imageUrl = `https://images.unsplash.com/photo-1544822688-c5f41d2c1f71?auto=format&fit=crop&q=80&w=800&h=1200`; // We will use a more robust URL builder later
            }

            // 1. Insert the main feed card FIRST (so the Foreign Key has something to attach to)
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

            // 2. Insert the deep dive SECOND
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
            return parsedData;

        } catch (dbOrParseError) {
             console.error("❌ ERROR during formatting or database insert:", dbOrParseError);
        }

    } catch (error) {
        console.error("❌ ERROR generating content:", error);
    }
}

// --- 3. EXECUTION ---
// Parse command line arguments
const args = process.argv.slice(2);
const validJobs = ['PERSON', 'PLACE', 'VERSE', 'INSPIRATIONAL'];

if (args.includes('--PERSON')) {
    runJob('PERSON');
} else if (args.includes('--PLACE')) {
    runJob('PLACE');
} else if (args.includes('--VERSE')) {
    runJob('VERSE');
} else if (args.includes('--INSPIRATIONAL')) {
    runJob('INSPIRATIONAL');
} else if (args.includes('--RANDOM')) {
    const randomJob = validJobs[Math.floor(Math.random() * validJobs.length)];
    console.log(`🎲 Random mode selected! Picked: ${randomJob}`);
    runJob(randomJob);
} else {
    console.log(`
❌ No valid flag provided.
Usage: node content.js [FLAG]

Available flags:
  --PERSON        Generate a biographical card
  --PLACE         Generate a location card
  --VERSE         Fetch and format a raw verse
  --INSPIRATIONAL Fetch a verse and write a devotional reflection
  --RANDOM        Pick one of the above at random
    `);
}