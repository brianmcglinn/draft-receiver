// --- On-page debug log ---
// Visit the page with ?debug=1 to see everything below directly on screen —
// no DevTools/console required. e.g. http://localhost:8000/?debug=1
const DEBUG = new URLSearchParams(location.search).has('debug');
const debugPanel = document.getElementById('debug-panel');
if (DEBUG) debugPanel.classList.remove('hidden');

function log(...args) {
  console.log(...args);
  if (DEBUG) {
    const line = document.createElement('div');
    line.textContent = args
      .map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
      .join(' ');
    debugPanel.appendChild(line);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  }
}

log('Booting receiver…');

if (CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') || CONFIG.SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
  log('⚠️ config.js still has placeholder values — update SUPABASE_URL / SUPABASE_ANON_KEY');
}

// --- Cast receiver session ---
// Registers this page as a valid Cast custom receiver and stops it from
// timing out during the long idle gaps between draft picks.
try {
  const castContext = cast.framework.CastReceiverContext.getInstance();
  castContext.start({ disableIdleTimeout: true });
  castContext.addEventListener(cast.framework.system.EventType.SENDER_CONNECTED, () => {
    log('📱 Sender (re)connected.');
    // The receiver page persists across disconnect/reconnect (that's the
    // whole point of disableIdleTimeout), so nothing else naturally
    // re-triggers playback here unless draft_state also happens to
    // change. Explicitly nudge the intro playlist to resume if we're
    // still on the idle screen.
    if (!idleScreen.classList.contains('hidden')) {
      startIntroPlaylist();
    }
  });
  log('Cast receiver context started.');
} catch (e) {
  log('Cast SDK not available (expected when testing in a plain browser tab):', e.message);
}

// --- Supabase ---
const db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
log('Supabase client created for', CONFIG.SUPABASE_URL);

const idleScreen = document.getElementById('idle-screen');
const clockScreen = document.getElementById('clock-screen');
const introLogosRow = document.getElementById('intro-logos-row');
const introLogo1VideoEl = document.getElementById('intro-logo1-video');
const introLogo2ImgEl = document.getElementById('intro-logo2-img');
const introLogo3VideoEl = document.getElementById('intro-logo3-video');
const idleMarkEl = document.getElementById('idle-mark');
const idleSubheading1El = document.getElementById('idle-subheading1');
const idleSubheading2El = document.getElementById('idle-subheading2');
const idleSubtextEl = document.getElementById('idle-subtext');
const introAudioEl = document.getElementById('intro-audio');
const logoEl = document.getElementById('logo');
const glowEl = document.getElementById('glow');
const teamNameEl = document.getElementById('team-name');
const ownerNameEl = document.getElementById('owner-name');
const pickMetaEl = document.getElementById('pick-meta');
const onDeckWrap = document.getElementById('on-deck');
const onDeckItems = document.getElementById('on-deck-items');
const audioEl = document.getElementById('walkup-audio');
const colorCanvas = document.getElementById('color-canvas');
const ctx = colorCanvas.getContext('2d');

let lastKey = null; // dedupe so unrelated row updates don't restart the song
let lastKnownSongUrl = null; // used by the manual test-play button below

const debugPlayBtn = document.getElementById('debug-play-btn');
if (DEBUG) {
  debugPlayBtn.classList.remove('hidden');
  debugPlayBtn.addEventListener('click', () => {
    if (!lastKnownSongUrl) {
      log('No song URL known yet — trigger a draft_state update with a song_stream_url first.');
      return;
    }
    log('Manual test play:', lastKnownSongUrl);
    audioEl.src = lastKnownSongUrl;
    audioEl.currentTime = 0;
    audioEl.play()
      .then(() => log('▶️ Manual playback started.'))
      .catch(err => log('❌ Manual playback failed:', err.message));
  });
}

// --- Intro screen (configurable idle screen: text, logo, playlist) ---
let introTracks = [];
let introTrackIndex = 0;
let introPlaying = false;

function playIntroTrack(index) {
  if (!introTracks.length) return;
  introTrackIndex = ((index % introTracks.length) + introTracks.length) % introTracks.length;
  introAudioEl.src = introTracks[introTrackIndex].streamUrl;
  introAudioEl.currentTime = 0;
  introAudioEl.play()
    .then(() => log('▶️ Intro track playing:', introTracks[introTrackIndex].title))
    .catch(err => log('❌ Intro playback failed:', err.message));
}

introAudioEl.addEventListener('ended', () => {
  if (introPlaying) playIntroTrack(introTrackIndex + 1);
});

function startIntroPlaylist() {
  if (!introTracks.length) return;
  introPlaying = true;
  if (introAudioEl.paused) {
    playIntroTrack(introTrackIndex);
  }
}

function stopIntroPlaylist() {
  introPlaying = false;
  introAudioEl.pause();
}

function setIdleTextLine(el, text) {
  if (text) {
    el.textContent = text;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function setVideoSlot(videoEl, url, muted) {
  if (url) {
    videoEl.muted = muted !== false;
    videoEl.src = url;
    videoEl.classList.remove('hidden');
    videoEl.play().catch(err => log('\u26a0\ufe0f Logo video autoplay blocked:', err.message));
  } else {
    videoEl.classList.add('hidden');
    videoEl.pause();
    videoEl.src = '';
  }
}

function setImageSlot(imgEl, url) {
  if (url) {
    imgEl.src = url;
    imgEl.classList.remove('hidden');
  } else {
    imgEl.classList.add('hidden');
    imgEl.src = '';
  }
}

function applyIntroSettings(row) {
  if (!row) return;
  idleMarkEl.textContent = row.heading_text || 'FANTASY DRAFT';
  idleMarkEl.style.color = row.heading_color || '#9AA3AE';

  setIdleTextLine(idleSubheading1El, row.subheading1_text);
  setIdleTextLine(idleSubheading2El, row.subheading2_text);
  idleSubheading1El.style.color = row.subheading_color || '#9AA3AE';
  idleSubheading2El.style.color = row.subheading_color || '#9AA3AE';

  idleSubtextEl.textContent = row.subtext || 'waiting for the next pick';
  idleSubtextEl.style.color = row.subtext_color || '#9AA3AE';

  // TEMPORARY DIAGNOSTIC: forcing a known-good public test video here,
  // bypassing whatever's actually saved, to isolate whether plain <video>
  // rendering works in this receiver context at all. Remove this
  // override once the test is done.
  setVideoSlot(introLogo1VideoEl, 'https://placeholdervideo.dev/1280x720', true);
  // setVideoSlot(introLogo1VideoEl, row.logo1_url, row.logo1_muted);
  setImageSlot(introLogo2ImgEl, row.logo_url);
  setVideoSlot(introLogo3VideoEl, row.logo3_url, row.logo3_muted);

  if (row.logo1_url || row.logo_url || row.logo3_url) {
    introLogosRow.classList.remove('hidden');
  } else {
    introLogosRow.classList.add('hidden');
  }

  introTracks = Array.isArray(row.playlist_tracks) ? row.playlist_tracks : [];
  introTrackIndex = 0;
}

async function loadIntroSettings() {
  const { data, error } = await db.from('intro_settings').select('*').eq('id', 1).single();
  if (error) {
    log('⚠️ Failed to load intro_settings (using defaults):', error.message);
    return;
  }
  applyIntroSettings(data);
  log('✅ Intro settings loaded.');
}

db.channel('intro_settings_changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'intro_settings' }, payload => {
    log('📡 Intro settings updated.');
    applyIntroSettings(payload.new);
  })
  .subscribe();


function extractGlowColor(imgEl) {
  try {
    ctx.drawImage(imgEl, 0, 0, 16, 16);
    const { data } = ctx.getImageData(0, 0, 16, 16);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue; // skip transparent pixels
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    document.documentElement.style.setProperty('--glow-color', `${r}, ${g}, ${b}`);
  } catch (e) {
    // Most likely a CORS-blocked logo host tainting the canvas — falls back
    // to the default amber glow, which is fine.
    console.warn('Color extraction skipped:', e.message);
  }
}

function renderOnDeck(list) {
  if (!Array.isArray(list) || list.length === 0) {
    onDeckWrap.classList.add('hidden');
    return;
  }
  onDeckWrap.classList.remove('hidden');
  onDeckItems.innerHTML = '';
  list.slice(0, 4).forEach(item => {
    const img = document.createElement('img');
    img.src = item.logo_url || '';
    img.alt = item.team_name || '';
    onDeckItems.appendChild(img);

    // Preload into the browser's cache now, so when this owner actually
    // comes up next, the main logo swap is instant instead of showing
    // the previous owner's logo while this one fetches.
    if (item.logo_url) {
      const preload = new Image();
      preload.crossOrigin = 'anonymous';
      preload.src = item.logo_url;
    }
  });
}

function renderState(row) {
  log('renderState called. status =', row ? row.status : row);

  if (!row || row.status !== 'on_the_clock') {
    clockScreen.classList.add('hidden');
    idleScreen.classList.remove('hidden');
    audioEl.pause();
    lastKey = null;
    startIntroPlaylist();
    return;
  }

  idleScreen.classList.add('hidden');
  clockScreen.classList.remove('hidden');
  stopIntroPlaylist();

  teamNameEl.textContent = row.team_name || '';
  ownerNameEl.textContent = row.owner_name || '';
  pickMetaEl.textContent = (row.round && row.pick_number)
    ? `ROUND ${row.round} · PICK ${row.pick_number}`
    : '';

  if (logoEl.src !== row.logo_url) {
    logoEl.crossOrigin = 'anonymous';
    logoEl.src = row.logo_url || '';
    logoEl.onload = () => extractGlowColor(logoEl);
  }

  renderOnDeck(row.on_deck);

  if (row.song_stream_url) {
    lastKnownSongUrl = row.song_stream_url;
  }

  // Only (re)start audio when this is genuinely a new pick
  const key = `${row.owner_name}::${row.song_stream_url}`;
  if (key !== lastKey) {
    lastKey = key;
    if (row.song_stream_url) {
      audioEl.src = row.song_stream_url;
      audioEl.currentTime = 0;
      audioEl.play()
        .then(() => log('▶️ Playback started.'))
        .catch(err => log('❌ Playback failed:', err.message, '(often needs one click on the page first when testing in a plain browser tab)'));
    }
  }
}

async function loadInitialState() {
  log('Fetching initial draft_state…');
  const { data, error } = await db.from('draft_state').select('*').eq('id', 1).single();
  if (error) {
    log('❌ Failed to load draft_state:', error.message);
    return;
  }
  log('✅ Initial state loaded.');
  renderState(data);
}

db.channel('draft_state_changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_state' }, payload => {
    log('📡 Realtime update received.');
    renderState(payload.new);
  })
  .subscribe(status => {
    log('Realtime subscription status:', status);
  });

loadInitialState();
loadIntroSettings();
