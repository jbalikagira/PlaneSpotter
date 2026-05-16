// ============================================================
// api/identify.js
// This file is a Vercel Serverless Function.
// On Vercel, requests to /api/identify are handled here.
// Locally, server.js handles /api/identify instead.
// ============================================================

require('dotenv').config();
const https = require('https');

// Tell Vercel to allow larger request bodies (needed for base64 images)
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

module.exports = async (req, res) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, mediaType } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'No image data received' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set' });
  }

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

  return new Promise((resolve) => {
    const anthropicRequest = https.request(options, (anthropicResponse) => {
      let rawData = '';

      anthropicResponse.on('data', (chunk) => { rawData += chunk; });

      anthropicResponse.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);

          if (parsed.type === 'error') {
            const msg = parsed.error && parsed.error.message ? parsed.error.message : 'Unknown API error';
            res.status(500).json({ error: `Anthropic API error: ${msg}` });
            return resolve();
          }

          if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
            res.status(500).json({ error: 'Unexpected response from Claude', raw: parsed });
            return resolve();
          }

          const claudeText = parsed.content[0].text;
          let planeData;

          try {
            planeData = JSON.parse(claudeText);
          } catch (e) {
            const match = claudeText.match(/\{[\s\S]*\}/);
            if (match) {
              planeData = JSON.parse(match[0]);
            } else {
              res.status(500).json({ error: 'Claude did not return valid JSON', raw: claudeText });
              return resolve();
            }
          }

          res.json(planeData);
          resolve();

        } catch (err) {
          res.status(500).json({ error: 'Failed to parse response', details: err.message });
          resolve();
        }
      });
    });

    anthropicRequest.on('error', (err) => {
      res.status(500).json({ error: 'Network error calling Anthropic API', details: err.message });
      resolve();
    });

    anthropicRequest.write(requestBody);
    anthropicRequest.end();
  });
};
