// ============================================================
// PlaneSpotter — server.js
// A simple Express server with two jobs:
//   1. Serve the frontend (index.html, style.css, script.js)
//   2. Accept a photo and ask Claude what plane it is
// ============================================================

// Load environment variables from .env file FIRST, before anything else
require('dotenv').config();

const express = require('express');
const https   = require('https');  // Built into Node — no install needed
const path    = require('path');   // Built into Node — helps with file paths

const app  = express();
const PORT = 3000;

// ── Middleware ────────────────────────────────────────────────
// Tell Express to parse incoming JSON bodies.
// We increase the size limit because base64 images can be large.
app.use(express.json({ limit: '50mb' }));

// Serve everything in this folder as static files.
// When the browser asks for /style.css, Express sends style.css automatically.
app.use(express.static(path.join(__dirname)));

// ── Route 1: GET / ───────────────────────────────────────────
// When someone visits http://localhost:3000 send them index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Route 2: POST /api/identify ──────────────────────────────
// The browser sends { imageBase64: "...", mediaType: "image/jpeg" }
// We forward it to Claude and send the result back.
app.post('/api/identify', async (req, res) => {
  const { imageBase64, mediaType } = req.body;

  // Basic guard — make sure we actually received image data
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image data received' });
  }

  // Make sure the API key is set
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
  }

  // ── Build the message we'll send to Claude ─────────────────
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
            // This is the "image content block" — tells Claude to look at a picture
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType || 'image/jpeg',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'What aircraft is in this photo? Respond with JSON only.',
          },
        ],
      },
    ],
  });

  // ── Call the Anthropic API over HTTPS ──────────────────────
  // We use Node's built-in https module to keep dependencies minimal.
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

  const anthropicRequest = https.request(options, (anthropicResponse) => {
    let rawData = '';

    // Collect the response chunks as they arrive
    anthropicResponse.on('data', (chunk) => {
      rawData += chunk;
    });

    // Once the full response is here, parse and forward it
    anthropicResponse.on('end', () => {
      try {
        const parsed = JSON.parse(rawData);

        // Check if the Anthropic API itself returned an error (e.g. rate limit, overload)
        if (parsed.type === 'error') {
          const apiErrorMsg = parsed.error && parsed.error.message
            ? parsed.error.message
            : 'Unknown Anthropic API error';
          return res.status(500).json({ error: `Anthropic API error: ${apiErrorMsg}` });
        }

        // Claude's response text lives inside content[0].text
        if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
          return res.status(500).json({ error: 'Unexpected response shape from Claude', raw: parsed });
        }

        const claudeText = parsed.content[0].text;

        // Claude should have returned pure JSON — parse it
        let planeData;
        try {
          planeData = JSON.parse(claudeText);
        } catch (jsonErr) {
          // If Claude added any surrounding text, try to extract the JSON object
          const match = claudeText.match(/\{[\s\S]*\}/);
          if (match) {
            planeData = JSON.parse(match[0]);
          } else {
            return res.status(500).json({ error: 'Claude did not return valid JSON', raw: claudeText });
          }
        }

        // Send the clean plane data back to the browser
        res.json(planeData);

      } catch (err) {
        res.status(500).json({ error: 'Failed to parse Anthropic response', details: err.message });
      }
    });
  });

  // Handle network errors (e.g. no internet)
  anthropicRequest.on('error', (err) => {
    res.status(500).json({ error: 'Network error calling Anthropic API', details: err.message });
  });

  // Send the request body and close the connection
  anthropicRequest.write(requestBody);
  anthropicRequest.end();
});

// ── Start listening ───────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✈️  PlaneSpotter is running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: check your IP address to test on your phone`);
});
