import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// Initialize the Google Gen AI client
const ai = new GoogleGenAI({});

// Initialize Supabase admin client (Bypasses RLS)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ ERROR: Supabase credentials not set in .env.");
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configuration for Gemini 2.5 Flash
const MODEL_NAME = 'gemini-2.5-flash';

// --- 1. JOB PROMPT TEMPLATES ---
// Turned into functions to dynamically inject "existing" names to avoid duplicates
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
    const prompt = templateFn(existingNames);

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
            if (jobType === 'PERSON' && parsedData.payload.deepDive) {
                extractedDeepDive = parsedData.payload.deepDive;
                delete finalPayload.deepDive;
                finalPayload.hasDeepDive = true; // Tell the frontend it exists
            }

            // Construct Unsplash URL from keyword
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
// You can now run whichever specific job you need!
//runJob('PERSON');
 runJob('PLACE');