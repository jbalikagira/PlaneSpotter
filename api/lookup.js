// ============================================================
// api/lookup.js  (improved)
// Look up an aircraft by registration number.
// Steps:
//   1. Ask FlightAware /aircraft/{ident} for the REAL aircraft type
//   2. Ask Claude for full specs using that confirmed type
//   3. Fetch a photo from Planespotters.net (free, no key needed)
//   4. Get live flight data from FlightAware /flights/{ident}
//   5. Return everything to the browser
//
// Using FlightAware for the type first makes identification
// much more accurate than asking Claude to guess from a reg number.
// ============================================================

require('dotenv').config();
const https = require('https');

// ── Helper: get aircraft type from FlightAware ────────────────
// Calls /aircraft/{ident} which returns the registered type code
// e.g. { type: "A20N", description: "Airbus A320 211" }
// Returns { typeCode, description } or null if not found / no key
function getAircraftType(registration) {
  // Can't do this without a FlightAware key
  if (!process.env.FLIGHTAWARE_API_KEY) return Promise.resolve(null);

  const ident = registration.trim().toUpperCase();

  const options = {
    hostname: 'aeroapi.flightaware.com',
    path: `/aeroapi/aircraft/${encodeURIComponent(ident)}`,
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
          // FlightAware returns type code (e.g. "A20N") and description
          if (parsed.type) {
            resolve({
              typeCode:    parsed.type,
              description: parsed.description || parsed.type,
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

// ── Helper: ask Claude for specs ──────────────────────────────
// If we know the confirmed aircraft type from FlightAware, we pass
// that in so Claude gives accurate specs instead of guessing.
function askClaudeForSpecs(registration, confirmedType) {
  const systemPrompt = `You are an expert aircraft database.
You MUST respond with ONLY valid JSON — no explanation, no prose, no markdown code fences.
Return exactly this structure:
{
  "aircraft_type": "e.g. Airbus A320neo",
  "manufacturer": "e.g. Airbus",
  "role": "e.g. Narrow-body airliner",
  "length_m": 37.57,
  "wingspan_m": 35.8,
  "max_speed_kmh": 903,
  "range_km": 6300,
  "passenger_capacity": 165,
  "first_flight_year": 2014,
  "notable_features": "CFM LEAP or PW1100G engines, Sharklet wingtip devices",
  "confidence": 0.97,
  "tail_number": "G-SUNL"
}`;

  // Build a clear prompt — tell Claude the confirmed type if we have it
  let userMessage;
  if (confirmedType) {
    userMessage = `Give me full specs for this aircraft:
Registration: ${registration.toUpperCase()}
Confirmed aircraft type code: ${confirmedType.typeCode}
Type description: ${confirmedType.description}

Use the confirmed type to give accurate specs. Return JSON only.`;
  } else {
    // Fallback: Claude guesses from the registration
    userMessage = `What aircraft has the registration ${registration.toUpperCase()}? Return specs as JSON only.`;
  }

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
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
            return reject(new Error(`Anthropic API error: ${parsed.error.message}`));
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
          } else {
            resolve(null);
          }
        } catch (e) { resolve(null); }
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
          } else { resolve(null); }
        } catch (e) { resolve(null); }
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

    // Step 1: Get the confirmed aircraft type from FlightAware (much more accurate)
    // This runs alongside the photo fetch to save time
    const [confirmedType, photoData] = await Promise.all([
      getAircraftType(cleanReg),
      getPhoto(cleanReg),
    ]);

    // Step 2: Ask Claude for full specs — passing the confirmed type if we got one
    const planeData = await askClaudeForSpecs(cleanReg, confirmedType);
    planeData.tail_number = cleanReg;

    // Step 3: Get live flight data
    let flightData = null;
    if (process.env.FLIGHTAWARE_API_KEY) {
      flightData = await getFlightData(cleanReg);
    }

    // Step 4: Send everything back
    res.json({
      ...planeData,
      flight: flightData,
      photo:  photoData,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
