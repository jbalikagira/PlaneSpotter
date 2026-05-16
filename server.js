// ============================================================
// PlaneSpotter — server.js  (Phase 3)
// Local development server.
// On Vercel, api/identify.js handles the API route instead.
// ============================================================

require('dotenv').config();

const express = require('express');
const https   = require('https');
const path    = require('path');

const app  = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Helper: call the Anthropic API ───────────────────────────
// Pass imageBase64 + mediaType for photo mode.
// Pass registration (and null for the others) for lookup mode.
function askClaude(imageBase64, mediaType, registration) {
  const systemPrompt = `You are an expert aircraft identification system.
You MUST respond with ONLY valid JSON — no explanation, no prose, no markdown code fences.
Return exactly this structure (fill in every field):
{
  "aircraft_type": "e.g. Boeing 737-800",
  "manufacturer": "e.g. Boeing",
  "role": "e.g. Narrow-body airliner",
  "length_m": 39.5,
  "wingspan_m": 35.8,
  "max_speed_kmh": 842,
  "range_km": 5765,
  "passenger_capacity": 162,
  "first_flight_year": 1998,
  "notable_features": "Winglets, CFM56 engines, glass cockpit",
  "confidence": 0.92,
  "tail_number": "N12345 or empty string if not visible"
}
If the aircraft cannot be identified, set confidence to 0 and use "Unknown" for text fields and 0 for numbers.`;

  // Build the user message differently depending on mode
  let userContent;
  if (registration) {
    // Registration lookup mode — text only, no image
    userContent = `What aircraft has the registration ${registration}? Return specs as JSON only.`;
  } else {
    // Photo identification mode — send image + text
    userContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
      },
      { type: 'text', text: 'What aircraft is in this photo? Respond with JSON only.' },
    ];
  }

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
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
            const msg = parsed.error && parsed.error.message ? parsed.error.message : 'Unknown API error';
            return reject(new Error(`Anthropic API error: ${msg}`));
          }
          if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
            return reject(new Error('Unexpected response shape from Claude'));
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

// ── Helper: call FlightAware AeroAPI ─────────────────────────
// Returns a flight info object, or null if nothing found.
function getFlightData(tailNumber) {
  const ident = tailNumber.trim().toUpperCase();

  const options = {
    hostname: 'aeroapi.flightaware.com',
    path: `/aeroapi/flights/${encodeURIComponent(ident)}`,
    method: 'GET',
    headers: {
      'x-apikey': process.env.FLIGHTAWARE_API_KEY,
    },
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

// ── Route: POST /api/identify ─────────────────────────────────
app.post('/api/identify', async (req, res) => {
  const { imageBase64, mediaType } = req.body;

  if (!imageBase64) return res.status(400).json({ error: 'No image data received' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });

  try {
    // Step 1: Ask Claude to identify the aircraft from the photo
    const planeData = await askClaude(imageBase64, mediaType, null);

    // Step 2: If a tail number was spotted, look up live flight data
    const hasTailNumber = planeData.tail_number && planeData.tail_number.trim() !== '';
    const hasFlightAwareKey = !!process.env.FLIGHTAWARE_API_KEY;

    let flightData = null;
    if (hasTailNumber && hasFlightAwareKey) {
      flightData = await getFlightData(planeData.tail_number);
    }

    // Step 3: Attach flight data and send everything back
    planeData.flight = flightData;
    res.json(planeData);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: fetch a photo from Planespotters.net ──────────────
function getPhoto(registration) {
  const cleanReg = registration.trim().toUpperCase();
  const options = {
    hostname: 'api.planespotters.net',
    path: `/pub/photos/reg/${encodeURIComponent(cleanReg)}`,
    method: 'GET',
    headers: { 'User-Agent': 'PlaneSpotter-App/1.0' },
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
              imageUrl:     photo.thumbnail_large ? photo.thumbnail_large.src : photo.thumbnail.src,
              photographer: photo.photographer || 'Unknown',
              link:         photo.link || 'https://www.planespotters.net',
            });
          } else { resolve(null); }
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ── Route: POST /api/lookup ───────────────────────────────────
app.post('/api/lookup', async (req, res) => {
  const { registration } = req.body;
  if (!registration || !registration.trim()) return res.status(400).json({ error: 'No registration provided' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });

  try {
    const cleanReg = registration.trim().toUpperCase();

    // Ask Claude for specs and fetch photo simultaneously
    const [planeData, photoData] = await Promise.all([
      askClaude(null, null, cleanReg),   // special registration-only mode
      getPhoto(cleanReg),
    ]);

    planeData.tail_number = cleanReg;

    let flightData = null;
    if (process.env.FLIGHTAWARE_API_KEY) {
      flightData = await getFlightData(cleanReg);
    }

    res.json({ ...planeData, flight: flightData, photo: photoData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start listening ───────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✈️  PlaneSpotter is running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: check your IP address to test on your phone`);
  });
}

module.exports = app;
