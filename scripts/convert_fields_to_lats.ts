import OpenAI from "openai";
import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(__dirname, "geocode_cache.json");
const OUTPUT_FILE = path.join(__dirname, "geocoded_results.json");
const BATCH_SIZE = 10;
const DELAY_MS = 1000;

interface User {
    id: string;
    name: string;
    real_name: string;
    location_field: string;
    school_field: string;
    phone: string;
    locale: string;
}

interface GeocodedUser extends User {
    lat?: number;
    long?: number;
    confidence?: number;
    method?: "geocoding" | "ai" | "failed";
}

const loadCache = (): Record<string, { lat: number; long: number; confidence: number }> => {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
        return {};
    }
};

const saveCache = (cache: Record<string, { lat: number; long: number; confidence: number }>) => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const geocodeWithNominatim = async (location: string): Promise<{ lat: number; long: number; confidence: number } | null> => {
    if (!location || location.toLowerCase().match(/no|nowhere|hq|chillin|cat kingdom/)) {
        return null;
    }

    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
        const response = await fetch(url, {
            headers: { "User-Agent": "CommunityMap/1.0" }
        });

        await sleep(1000); // Nominatim rate limit

        const data = await response.json() as Array<{ lat: string; lon: string; importance: number }>;

        if (data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                long: parseFloat(data[0].lon),
                confidence: Math.min(data[0].importance * 100, 95)
            };
        }
    } catch (error) {
        console.error(`Geocoding failed for "${location}":`, error);
    }

    return null;
};

const geocodeWithAI = async (users: User[], ai: OpenAI): Promise<Array<{ id: string; lat: number; long: number; confidence: number }>> => {
    try {
        const response = await ai.chat.completions.create({
            model: "gpt-4o-mini",
            response_format: { type: "json_object" },
            messages: [{
                role: "system",
                content: `Extract approximate latitude and longitude for each user based on their location_field. Return JSON in format: {"results": [{"id": "user_id", "lat": number, "long": number, "confidence": number}]}. Confidence is 0-100. Skip locations that are jokes or invalid.`
            }, {
                role: "user",
                content: JSON.stringify(users.map(u => ({ id: u.id, location: u.location_field })))
            }]
        });

        const result = JSON.parse(response.choices[0]?.message?.content || "{}");
        return result.results || [];
    } catch (error) {
        console.error("AI geocoding failed:", error);
        return [];
    }
};

const processBatch = async (batch: User[], cache: Record<string, any>, ai: OpenAI): Promise<GeocodedUser[]> => {
    const results: GeocodedUser[] = [];
    const needsAI: User[] = [];

    for (const user of batch) {
        const cacheKey = user.location_field.toLowerCase().trim();

        if (cache[cacheKey]) {
            results.push({
                ...user,
                ...cache[cacheKey],
                method: "geocoding"
            });
            continue;
        }

        const geoResult = await geocodeWithNominatim(user.location_field);

        if (geoResult) {
            cache[cacheKey] = geoResult;
            results.push({
                ...user,
                ...geoResult,
                method: "geocoding"
            });
        } else {
            needsAI.push(user);
        }
    }

    if (needsAI.length > 0) {
        const aiResults = await geocodeWithAI(needsAI, ai);

        for (const user of needsAI) {
            const aiResult = aiResults.find(r => r.id === user.id);

            if (aiResult) {
                const cacheKey = user.location_field.toLowerCase().trim();
                cache[cacheKey] = {
                    lat: aiResult.lat,
                    long: aiResult.long,
                    confidence: aiResult.confidence
                };
                results.push({
                    ...user,
                    ...aiResult,
                    method: "ai"
                });
            } else {
                results.push({
                    ...user,
                    method: "failed"
                });
            }
        }
    }

    return results;
};

const main = async () => {
    const data: User[] = JSON.parse(fs.readFileSync(path.join(__dirname, "users_with_fields.json"), "utf8"));
    const cache = loadCache();
    const ai = new OpenAI({
        apiKey: process.env.OPENAI_KEY
    });

    const allResults: GeocodedUser[] = [];

    for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(data.length / BATCH_SIZE)}...`);

        const results = await processBatch(batch, cache, ai);
        allResults.push(...results);

        saveCache(cache);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

        console.log(`Completed: ${allResults.length}/${data.length}`);

        if (i + BATCH_SIZE < data.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log("\nSummary:");
    console.log(`- Geocoded: ${allResults.filter(r => r.method === "geocoding").length}`);
    console.log(`- AI: ${allResults.filter(r => r.method === "ai").length}`);
    console.log(`- Failed: ${allResults.filter(r => r.method === "failed").length}`);
    console.log(`\nResults saved to: ${OUTPUT_FILE}`);
};

main();
