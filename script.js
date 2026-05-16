// ============================================================
// PlaneSpotter — script.js
// Runs in the browser. Handles:
//   1. Button click → open camera / file picker
//   2. Image selected → show preview + start upload
//   3. Upload → show spinner → get result → show results card
// ============================================================

// ── Grab references to every HTML element we'll touch ────────
const identifyBtn    = document.getElementById('identifyBtn');
const imageInput     = document.getElementById('imageInput');
const previewSection = document.getElementById('previewSection');
const previewImage   = document.getElementById('previewImage');
const loadingSection = document.getElementById('loadingSection');
const errorSection   = document.getElementById('errorSection');
const errorMessage   = document.getElementById('errorMessage');
const resultsCard    = document.getElementById('resultsCard');

// Results card fields
const aircraftName    = document.getElementById('aircraftName');
const roleText        = document.getElementById('roleText');
const specManufacturer = document.getElementById('specManufacturer');
const specLength      = document.getElementById('specLength');
const specWingspan    = document.getElementById('specWingspan');
const specSpeed       = document.getElementById('specSpeed');
const specRange       = document.getElementById('specRange');
const specPassengers  = document.getElementById('specPassengers');
const specFirstFlight = document.getElementById('specFirstFlight');
const specFeatures    = document.getElementById('specFeatures');
const specTailNumber  = document.getElementById('specTailNumber');
const specConfidence  = document.getElementById('specConfidence');

// ── Step 1: Button click → trigger the hidden file input ─────
// We keep the real input hidden because it's ugly.
// Our nice button just "clicks" the input on behalf of the user.
identifyBtn.addEventListener('click', () => {
  imageInput.click();
});

// ── Step 2: User picked a photo ───────────────────────────────
imageInput.addEventListener('change', (event) => {
  const file = event.target.files[0];

  // If they cancelled the picker, do nothing
  if (!file) return;

  // Show a preview of the selected photo
  const objectURL = URL.createObjectURL(file);
  previewImage.src = objectURL;
  show(previewSection);

  // Start the identification process
  identifyPlane(file);

  // Reset the input so the user can pick the same photo again later
  imageInput.value = '';
});

// ── Step 3: The main identification function ─────────────────
async function identifyPlane(file) {
  // Hide old results / errors, show spinner
  hide(resultsCard);
  hide(errorSection);
  show(loadingSection);

  try {
    // Convert the image file to base64 text.
    // base64 is a way to turn binary (image) data into plain text
    // so we can send it in a JSON body.
    const { base64Data, mediaType } = await fileToBase64(file);

    // Send the image to our own server (which will forward it to Claude)
    const response = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64Data,
        mediaType: mediaType,
      }),
    });

    // Parse the JSON response from the server
    const data = await response.json();

    if (!response.ok) {
      // Server returned an error (4xx or 5xx status)
      throw new Error(data.error || 'Server error');
    }

    // Success! Show the results
    hide(loadingSection);
    showResults(data);

  } catch (err) {
    // Something went wrong — show the error to the user
    hide(loadingSection);
    showError(err.message || 'Something went wrong. Please try again.');
  }
}

// ── Helper: Convert a File object to base64, resizing if too large ───
// The Anthropic API has a 5MB image limit.
// We resize anything large down to max 1600px on its longest side before sending.
// Returns a promise that resolves to { base64Data, mediaType }
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const fullDataUrl = reader.result;

      // Create an Image element to get the dimensions
      const img = new Image();
      img.onload = () => {
        const MAX_SIZE = 1600; // max pixels on the longest side
        let width  = img.width;
        let height = img.height;

        // Only resize if the image is bigger than our limit
        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_SIZE);
            width  = MAX_SIZE;
          } else {
            width  = Math.round((width / height) * MAX_SIZE);
            height = MAX_SIZE;
          }
        }

        // Draw the (possibly resized) image onto a canvas
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG at 85% quality — keeps size small, quality good
        const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const commaIndex     = resizedDataUrl.indexOf(',');
        const base64Data     = resizedDataUrl.slice(commaIndex + 1);

        resolve({ base64Data, mediaType: 'image/jpeg' });
      };

      img.onerror = () => reject(new Error('Failed to load image for resizing'));
      img.src = fullDataUrl;
    };

    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

// ── Helper: Populate and show the results card ───────────────
function showResults(data) {
  // Fill in every field from Claude's JSON response
  aircraftName.textContent     = data.aircraft_type    || 'Unknown Aircraft';
  roleText.textContent         = data.role             || '';
  specManufacturer.textContent = data.manufacturer     || '—';
  specLength.textContent       = data.length_m         ? `${data.length_m} m` : '—';
  specWingspan.textContent     = data.wingspan_m       ? `${data.wingspan_m} m` : '—';
  specSpeed.textContent        = data.max_speed_kmh    ? `${data.max_speed_kmh} km/h` : '—';
  specRange.textContent        = data.range_km         ? `${data.range_km} km` : '—';
  specPassengers.textContent   = data.passenger_capacity || '—';
  specFirstFlight.textContent  = data.first_flight_year || '—';
  specFeatures.textContent     = data.notable_features  || '—';
  specTailNumber.textContent   = data.tail_number       || 'Not visible';

  // Convert confidence (0–1) to a percentage, e.g. 0.92 → "92%"
  const confidencePct = data.confidence != null
    ? `${Math.round(data.confidence * 100)}%`
    : '—';
  specConfidence.textContent = confidencePct;

  show(resultsCard);
}

// ── Helper: Show an error message ────────────────────────────
function showError(message) {
  errorMessage.textContent = '⚠️ ' + message;
  show(errorSection);
}

// ── Tiny utilities to show/hide elements ─────────────────────
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
