// ============================================================
// PlaneSpotter — script.js  (Phase 3 + Registration Lookup)
// ============================================================

// ── Grab all HTML elements we'll touch ───────────────────────
const identifyBtn          = document.getElementById('identifyBtn');
const imageInput           = document.getElementById('imageInput');
const lookupBtn            = document.getElementById('lookupBtn');
const lookupForm           = document.getElementById('lookupForm');
const regInput             = document.getElementById('regInput');
const regSearchBtn         = document.getElementById('regSearchBtn');
const previewSection       = document.getElementById('previewSection');
const previewImage         = document.getElementById('previewImage');
const photoCredit          = document.getElementById('photoCredit');
const loadingSection       = document.getElementById('loadingSection');
const loadingText          = document.getElementById('loadingText');
const errorSection         = document.getElementById('errorSection');
const errorMessage         = document.getElementById('errorMessage');
const lowConfidenceSection = document.getElementById('lowConfidenceSection');
const lowConfidenceMessage = document.getElementById('lowConfidenceMessage');
const resultsCard          = document.getElementById('resultsCard');
const historySection       = document.getElementById('historySection');
const historyGrid          = document.getElementById('historyGrid');
const clearHistoryBtn      = document.getElementById('clearHistoryBtn');

// Results card fields
const aircraftName     = document.getElementById('aircraftName');
const roleText         = document.getElementById('roleText');
const specManufacturer = document.getElementById('specManufacturer');
const specLength       = document.getElementById('specLength');
const specWingspan     = document.getElementById('specWingspan');
const specSpeed        = document.getElementById('specSpeed');
const specRange        = document.getElementById('specRange');
const specPassengers   = document.getElementById('specPassengers');
const specFirstFlight  = document.getElementById('specFirstFlight');
const specFeatures     = document.getElementById('specFeatures');
const specTailNumber   = document.getElementById('specTailNumber');
const specConfidence   = document.getElementById('specConfidence');
const confidenceBar    = document.getElementById('confidenceBar');

// Live flight elements
const flightSection     = document.getElementById('flightSection');
const noFlightSection   = document.getElementById('noFlightSection');
const flightNumber      = document.getElementById('flightNumber');
const flightOrigin      = document.getElementById('flightOrigin');
const flightDestination = document.getElementById('flightDestination');
const flightDeparture   = document.getElementById('flightDeparture');
const flightStatus      = document.getElementById('flightStatus');

// ── Constants ─────────────────────────────────────────────────
const LOW_CONFIDENCE_THRESHOLD = 0.50;
const HISTORY_KEY  = 'planespotter_history';
const MAX_HISTORY  = 20;

// ── On page load ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  renderHistory();
});

// ── Button 1: open camera / file picker ──────────────────────
identifyBtn.addEventListener('click', () => {
  // Hide the lookup form if it was open
  hide(lookupForm);
  imageInput.click();
});

// ── Button 2: toggle the registration lookup form ────────────
lookupBtn.addEventListener('click', () => {
  const isVisible = !lookupForm.classList.contains('hidden');
  if (isVisible) {
    hide(lookupForm);
  } else {
    show(lookupForm);
    regInput.focus(); // put the cursor straight in the box
  }
});

// ── Search button inside lookup form ─────────────────────────
regSearchBtn.addEventListener('click', () => {
  const reg = regInput.value.trim();
  if (reg) lookupByRegistration(reg);
});

// Also allow pressing Enter in the input box
regInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const reg = regInput.value.trim();
    if (reg) lookupByRegistration(reg);
  }
});

// ── "Try Again" buttons → reset the UI ───────────────────────
document.getElementById('tryAgainBtn').addEventListener('click', resetUI);
document.getElementById('tryAgainBtn2').addEventListener('click', resetUI);

// ── Clear history button ──────────────────────────────────────
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// ── User picked a photo ───────────────────────────────────────
imageInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Show preview
  const objectURL = URL.createObjectURL(file);
  previewImage.src = objectURL;
  show(previewSection);

  // Start identification
  identifyPlane(file);

  // Reset so the same photo can be picked again
  imageInput.value = '';
});

// ── Main identification function ──────────────────────────────
async function identifyPlane(file) {
  hide(resultsCard);
  hide(errorSection);
  hide(lowConfidenceSection);
  show(loadingSection);

  try {
    // Resize + convert to base64
    const { base64Data, mediaType, thumbnailDataUrl } = await fileToBase64(file);

    // Check for internet before trying
    if (!navigator.onLine) {
      throw new Error('You appear to be offline. Please check your internet connection and try again.');
    }

    // Send to our server
    const response = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64Data, mediaType }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Server returned an error. Please try again.');
    }

    hide(loadingSection);

    // ── Low confidence check ──────────────────────────────────
    // If Claude isn't sure this is a plane, show a friendly warning
    if (data.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceMessage.textContent =
        `I'm not confident this is an aircraft (${Math.round(data.confidence * 100)}% sure). ` +
        `Try a clearer photo with the whole plane visible, or a different angle.`;
      show(lowConfidenceSection);
      return; // Don't show results or save to history
    }

    // ── Show results ──────────────────────────────────────────
    showResults(data);

    // ── Save to history ───────────────────────────────────────
    saveToHistory(data, thumbnailDataUrl);
    renderHistory();

  } catch (err) {
    hide(loadingSection);

    // Give a friendly message for common problems
    let friendlyMessage = err.message;
    if (err.message.includes('fetch') || err.message.includes('NetworkError') || err.message.includes('Failed to fetch')) {
      friendlyMessage = 'Could not reach the server. Are you offline, or is the server running?';
    }

    showError(friendlyMessage);
  }
}

// ── Registration lookup function ─────────────────────────────
async function lookupByRegistration(registration) {
  hide(resultsCard);
  hide(errorSection);
  hide(lowConfidenceSection);
  hide(previewSection);
  show(loadingSection);
  loadingText.textContent = `Looking up ${registration.toUpperCase()}…`;

  try {
    if (!navigator.onLine) {
      throw new Error('You appear to be offline. Please check your internet connection.');
    }

    const response = await fetch('/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Server returned an error. Please try again.');
    }

    hide(loadingSection);
    loadingText.textContent = 'Analysing aircraft…'; // reset for next time

    // If a photo came back from Planespotters, show it
    if (data.photo && data.photo.imageUrl) {
      previewImage.src = data.photo.imageUrl;
      // Show photo credit
      photoCredit.innerHTML = `Photo by ${data.photo.photographer} via <a href="${data.photo.link}" target="_blank" rel="noopener">Planespotters.net</a>`;
      show(previewSection);
      show(photoCredit);
    } else {
      // No photo found — hide preview
      hide(previewSection);
    }

    // Show results (same card as photo identification)
    showResults(data);

    // Save to history using the Planespotters image as thumbnail (or a placeholder)
    const thumbnailUrl = data.photo ? data.photo.imageUrl : null;
    if (thumbnailUrl) {
      saveToHistory(data, thumbnailUrl);
      renderHistory();
    }

  } catch (err) {
    hide(loadingSection);
    loadingText.textContent = 'Analysing aircraft…';
    let friendlyMessage = err.message;
    if (err.message.includes('fetch') || err.message.includes('Failed to fetch')) {
      friendlyMessage = 'Could not reach the server. Are you offline, or is the server running?';
    }
    showError(friendlyMessage);
  }
}

// ── Helper: resize image and convert to base64 ───────────────
// Also returns a small thumbnail data URL for the history display
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        // ── Full-size (resized) version for Claude ────────────
        const MAX_SIZE = 1600;
        let width  = img.width;
        let height = img.height;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height / width) * MAX_SIZE);
            width  = MAX_SIZE;
          } else {
            width  = Math.round((width / height) * MAX_SIZE);
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64Data     = resizedDataUrl.split(',')[1];

        // ── Small thumbnail for history display ───────────────
        // We keep this tiny (200×200) so localStorage doesn't fill up
        const THUMB = 200;
        let tw = img.width, th = img.height;
        if (tw > th) { th = Math.round((th / tw) * THUMB); tw = THUMB; }
        else         { tw = Math.round((tw / th) * THUMB); th = THUMB; }

        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width  = tw;
        thumbCanvas.height = th;
        thumbCanvas.getContext('2d').drawImage(img, 0, 0, tw, th);
        const thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.6);

        resolve({ base64Data, mediaType: 'image/jpeg', thumbnailDataUrl });
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

// ── Helper: fill in and show the results card ─────────────────
function showResults(data) {
  aircraftName.textContent     = data.aircraft_type     || 'Unknown Aircraft';
  roleText.textContent         = data.role              || '';
  specManufacturer.textContent = data.manufacturer      || '—';
  specLength.textContent       = data.length_m          ? `${data.length_m} m`      : '—';
  specWingspan.textContent     = data.wingspan_m        ? `${data.wingspan_m} m`    : '—';
  specSpeed.textContent        = data.max_speed_kmh     ? `${data.max_speed_kmh} km/h` : '—';
  specRange.textContent        = data.range_km          ? `${data.range_km} km`     : '—';
  specPassengers.textContent   = data.passenger_capacity || '—';
  specFirstFlight.textContent  = data.first_flight_year || '—';
  specFeatures.textContent     = data.notable_features  || '—';
  specTailNumber.textContent   = data.tail_number       || 'Not visible';

  // Confidence bar
  const pct = data.confidence != null ? Math.round(data.confidence * 100) : 0;
  specConfidence.textContent = `${pct}%`;
  confidenceBar.style.width  = `${pct}%`;

  // Colour the bar based on confidence level
  confidenceBar.classList.remove('low', 'medium');
  if (data.confidence < 0.5)      confidenceBar.classList.add('low');
  else if (data.confidence < 0.75) confidenceBar.classList.add('medium');
  // else: default blue (high confidence)

  // ── Live flight data ──────────────────────────────────────
  // data.flight is either an object (found) or null (not found)
  hide(flightSection);
  hide(noFlightSection);

  const hasTailNumber = data.tail_number && data.tail_number.trim() !== '';

  if (hasTailNumber) {
    if (data.flight) {
      // We have live flight data — show it
      flightNumber.textContent      = data.flight.flight_number || '—';
      flightOrigin.textContent      = data.flight.origin        || '—';
      flightDestination.textContent = data.flight.destination   || '—';
      flightDeparture.textContent   = data.flight.departure_time
        ? new Date(data.flight.departure_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : '—';

      // Colour the status text based on what it says
      const statusText = data.flight.status || 'Unknown';
      flightStatus.textContent  = statusText;
      flightStatus.className    = ''; // clear old classes
      if (statusText.toLowerCase().includes('route'))   flightStatus.classList.add('status-enroute');
      else if (statusText.toLowerCase().includes('land')) flightStatus.classList.add('status-landed');
      else if (statusText.toLowerCase().includes('delay')) flightStatus.classList.add('status-delayed');
      else flightStatus.classList.add('status-other');

      show(flightSection);
    } else {
      // Tail number was found but no flight data
      show(noFlightSection);
    }
  }
  // If no tail number visible at all, we show nothing for flight data

  show(resultsCard);
}

// ── Helper: show error message ────────────────────────────────
function showError(message) {
  errorMessage.textContent = '⚠️ ' + message;
  show(errorSection);
}

// ── Helper: reset to initial state ───────────────────────────
function resetUI() {
  hide(errorSection);
  hide(lowConfidenceSection);
  hide(resultsCard);
  hide(previewSection);
  hide(loadingSection);
  hide(photoCredit);
}

// ── localStorage history helpers ──────────────────────────────

// Save one identification to localStorage
function saveToHistory(data, thumbnailDataUrl) {
  const history = loadHistory();

  // Build a history entry
  const entry = {
    id:           Date.now(),                    // unique ID = timestamp in milliseconds
    timestamp:    new Date().toISOString(),       // e.g. "2025-05-16T19:30:00.000Z"
    aircraft_type: data.aircraft_type || 'Unknown',
    confidence:   data.confidence,
    thumbnail:    thumbnailDataUrl,              // small JPEG data URL
    data:         data,                          // full result for re-opening
  };

  // Add to the front of the array (newest first)
  history.unshift(entry);

  // Keep only the most recent MAX_HISTORY items
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }

  // Save back to localStorage
  // localStorage only stores strings, so we convert to JSON text
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (e) {
    // localStorage can be full (rare) — silently ignore
    console.warn('Could not save to history:', e);
  }
}

// Load history array from localStorage
function loadHistory() {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

// Render the history grid from localStorage
function renderHistory() {
  const history = loadHistory();

  if (history.length === 0) {
    hide(historySection);
    return;
  }

  show(historySection);
  historyGrid.innerHTML = ''; // clear old items

  history.forEach((entry) => {
    // Create the card element
    const item = document.createElement('div');
    item.className = 'history-item';

    // Format the time nicely, e.g. "Today 19:30" or "15 May 19:30"
    const timeLabel = formatTime(entry.timestamp);

    item.innerHTML = `
      <img src="${entry.thumbnail}" alt="${entry.aircraft_type}" loading="lazy" />
      <div class="history-item-info">
        <div class="history-item-name">${entry.aircraft_type}</div>
        <div class="history-item-time">${timeLabel}</div>
      </div>
    `;

    // Clicking a history item re-shows its results
    item.addEventListener('click', () => {
      // Show the thumbnail as the preview
      previewImage.src = entry.thumbnail;
      show(previewSection);

      // Re-show the results
      hide(errorSection);
      hide(lowConfidenceSection);
      showResults(entry.data);

      // Scroll up so the user can see the results
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    historyGrid.appendChild(item);
  });
}

// ── Helper: format a timestamp into a readable label ─────────
function formatTime(isoString) {
  const date  = new Date(isoString);
  const now   = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Today ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return `${dateStr} ${timeStr}`;
  }
}

// ── Tiny show/hide utilities ──────────────────────────────────
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
