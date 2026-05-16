// ============================================================
// api/lookup.js
// Look up an aircraft by registration number (tail number).
// Steps:
//   1. Ask Claude for full specs based on the registration
//   2. Fetch a photo from Planespotters.net (free, no key needed)
//   3. Get live flight data from FlightAware (if key is set)
//   4. Return everything to the browser
// ============================================================

require('dotenv').config();
const https = require('https');

// ── Helper: ask Claude for specs given a registration ─────────
function askClaudeForReg(registration) {
  const systemPrompt = `You are an expert aircraft database.
When given an aircraft registration number, identify what aircraft it is and return its specifications.
You MUST respond with ONLY valid JSON — no explanation, no prose, no markdown code fences.
Return exactly this structure:
{
  "aircraft_type": "e.g. Dassault Falcon 7X",
  "manufacturer": "e.g. Dassault Aviation",
  "role": "e.g. Ultra-long-range business jet",
  "length_m": 23.4,
  "wingspan_m": 26.2,
  "max_speed_kmh": 953,
  "range_km": 11000,
  "passenger_capacity": 16,
  "first_flight_year": 2005,
  "notable_features": "Tri-engine layout, fly-by-wire controls, winglets",
  "confidence": 0.9,
  "tail_number": "C-GWFM"
}
Use your knowledge to identify the aircraft type for this registration.
If you're unsure of the exact aircraft for this registration, give specs for the most likely type and lower the confidence score.
If you have no idea at all, set confidence to 0 and use "Unknown" for text fields.`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `What aircraft has the registration ${registration.toUpperCase()}? Return specs as JSON only.`,
      },
    ],
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (response) => {
      let rawData = '';
      response.on('data', (chunk) => { rawData += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);

          if (parsed.type === 'error') {
            const msg = parsed.error && parsed.error.message ? parsed.error.message : 'Unknown error';
            return reject(new Error(`Anthropic API error: ${msg}`));
          }

          if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
            return reject(new Error('Unexpected response from Claude'));
          }

          const claudeText = parsed.content[0].text;
          let planeData;

          try {
            planeData = JSON.parse(claudeText);
          } catch (e) {
            const match = claudeText.match(/\{[\s\S]*\}/);
            if (match) { planeData = JSON.parse(match[0]); }
            else { return reject(new Error('Claude did not return valid JSON')); }
          }

          resolve(planeData);
        } catch (err) {
          reject(new Error('Failed to parse Claude response: ' + err.message));
        }
      });
    });
    req.on('error', (err) => reject(new Error('Network error: ' + err.message)));
    req.write(requestBody);
    req.end();
  });
}

// ── Helper: fetch a photo from Planespotters.net ──────────────
// Planespotters.net is a free public API — no key needed.
// Returns { imageUrl, photographer, link } or null if no photo found.
function getPhoto(registration) {
  const cleanReg = registration.trim().toUpperCase();

  const options = {
    hostname: 'api.planespotters.net',
    path: `/pub/photos/reg/${encodeURIComponent(cleanReg)}`,
    method: 'GET',
    headers: {
      // Identify ourselves politely
      'User-Agent': 'PlaneSpotter-App/1.0',
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (response) => {
      let rawData = '';
      response.on('data', (chunk) => { rawData += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);

          if (parsed.photos && parsed.photos.length > 0) {
            const photo = parsed.photos[0];
            resolve({
              // Use the large thumbnail if available, otherwise the small one
              imageUrl:     photo.thumbnail_large ? photo.thumbnail_large.src : photo.thumbnail.src,
              photographer: photo.photographer || 'Unknown',
              link:         photo.link || 'https://www.planespotters.net',
            });
          } else {
            resolve(null); // No photo found
          }
        } catch (e) {
          resolve(null); // Parse error — treat as no photo
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ── Helper: get live flight data from FlightAware ─────────────
function getFlightData(tailNumber) {
  const ident = tailNumber.trim().toUpperCase();

  const options = {
    hostname: 'aeroapi.flightaware.com',
    path: `/aeroapi/flights/${encodeURIComponent(ident)}`,
    method: 'GET',
    headers: { 'x-apikey': process.env.FLIGHTAWARE_API_KEY },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (response) => {
      let rawData = '';
      response.on('data', (chunk) => { rawData += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed.flights && parsed.flights.length > 0) {
            const f = parsed.flights[0];
            resolve({
              origin:         f.origin      ? `${f.origin.city} (${f.origin.code_iata || f.origin.code})`           : 'Unknown',
              destination:    f.destination ? `${f.destination.city} (${f.destination.code_iata || f.destination.code})` : 'Unknown',
              departure_time: f.actual_out  || f.scheduled_out || null,
              status:         f.status      || 'Unknown',
              flight_number:  f.ident       || ident,
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { registration } = req.body;

  if (!registration || !registration.trim()) {
    return res.status(400).json({ error: 'No registration provided' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }

  try {
    const cleanReg = registration.trim().toUpperCase();

    // Run Claude lookup and photo fetch at the same time (faster than one after the other)
    const [planeData, photoData] = await Promise.all([
      askClaudeForReg(cleanReg),
      getPhoto(cleanReg),
    ]);

    // Make sure the tail_number field reflects what the user typed
    planeData.tail_number = cleanReg;

    // Get flight data if FlightAware key exists
    let flightData = null;
    if (process.env.FLIGHTAWARE_API_KEY) {
      flightData = await getFlightData(cleanReg);
    }

    // Send everything back
    res.json({
      ...planeData,
      flight: flightData,
      photo:  photoData,   // { imageUrl, photographer, link } or null
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
