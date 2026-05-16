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
function askClaude(imageBase64, mediaType) {
  const systemPrompt = `You are an expert aircraft identification system.
When shown a photo, you MUST respond with ONLY valid JSON — no explanation, no prose, no markdown code fences.
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
If the image does not appear to contain an aircraft, still return the JSON but set confidence to 0 and use "Unknown" for text fields and 0 for numbers.`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: 'What aircraft is in this photo? Respond with JSON only.' },
        ],
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
    // Step 1: Ask Claude to identify the aircraft
    const planeData = await askClaude(imageBase64, mediaType);

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

// ── Start listening ───────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✈️  PlaneSpotter is running!`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: check your IP address to test on your phone`);
  });
}

module.exports = app;
