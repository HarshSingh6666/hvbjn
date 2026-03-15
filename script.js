/* =====================================================
   J.A.R.V.I.S — Voice Assistant Script
   ===================================================== */

// ── State ──────────────────────────────────────────
const STATE = {
  apiKey: 'AIzaSyCp2bvK5BnWG86N9K561dL4-d-xuKflB3A',  // Gemini API Key
  geminiModel: 'gemini-2.5-flash',                           // Gemini Model
  isListening: false,
  isSpeaking: false,
  history: [],
  recognition: null,
  synth: window.speechSynthesis,
  currentUtterance: null,
  wakeWordMode: false,
  wakeRecognition: null,
};

// ── DOM Refs ───────────────────────────────────────
const $ = id => document.getElementById(id);
const listenBtn     = $('listenBtn');
const stopBtn       = $('stopBtn');
const clearBtn      = $('clearBtn');
const transcriptEl  = $('transcriptText');
const responseEl    = $('responseText');
const statusDot     = $('statusDot');
const statusText    = $('statusText');
const stateLabel    = $('stateLabelText');
const arcProgress   = $('arcProgress');
const arcReactor    = $('arcReactor');
const waveform      = $('waveform');
const historyList   = $('historyList');
const historyCount  = $('historyCount');
const clockEl       = $('clockDisplay');
const apiKeyInput   = $('apiKeyInput');
const saveApiBtn    = $('saveApiBtn');
const chips         = document.querySelectorAll('.chip');

// ── Init ───────────────────────────────────────────
(function init() {
  spawnParticles();
  buildWaveform();
  startClock();
  setupApiPanel();
  setupButtons();
  setupKeyboardShortcut();
  setupChips();

  // API key is pre-configured
  apiKeyInput.value = '●'.repeat(20);
  setStatus('ONLINE', 'online');
  speak("J.A.R.V.I.S online. Good to have you back, sir.");
})();

// ── Particles ──────────────────────────────────────
function spawnParticles() {
  const container = $('particles');
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      --dur: ${6 + Math.random() * 10}s;
      --delay: ${Math.random() * 10}s;
    `;
    container.appendChild(p);
  }
}

// ── Waveform ───────────────────────────────────────
function buildWaveform() {
  const barCount = 24;
  for (let i = 0; i < barCount; i++) {
    const bar = document.createElement('div');
    bar.className = 'wave-bar';
    const maxH = 8 + Math.random() * 28;
    bar.style.setProperty('--amx', `${maxH}px`);
    bar.style.setProperty('--adur', `${0.3 + Math.random() * 0.5}s`);
    bar.style.setProperty('--adel', `${(i / barCount) * 0.6}s`);
    waveform.appendChild(bar);
  }
}

function setWaveActive(active) {
  waveform.classList.toggle('active', active);
}

// ── Clock ──────────────────────────────────────────
function startClock() {
  function update() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  update();
  setInterval(update, 1000);
}

// ── Status helpers ─────────────────────────────────
function setStatus(text, type = 'online') {
  statusText.textContent = text;
  stateLabel.textContent = text;
  statusDot.className = 'status-dot ' + type;
}

function setArcProgress(pct) {
  const circumference = 283;
  arcProgress.style.strokeDashoffset = circumference - (circumference * pct / 100);
}

// ── API Panel ──────────────────────────────────────
function setupApiPanel() {
  saveApiBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key && !key.startsWith('●')) {
      STATE.apiKey = key;
      localStorage.setItem('jarvis_gemini_key', key);
      apiKeyInput.value = '●'.repeat(20);
      setStatus('ONLINE', 'online');
      speak("Gemini API key activated. All systems operational, sir.");
    }
  });
  apiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveApiBtn.click();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (apiKeyInput.value.startsWith('●')) {
        apiKeyInput.value = '';
        STATE.apiKey = '';
        localStorage.removeItem('jarvis_gemini_key');
      }
    }
  });
}

// ── Buttons ────────────────────────────────────────
function setupButtons() {
  // Support both click and touch for mobile
  function toggleListen(e) {
    e.preventDefault();
    if (STATE.isListening) stopListening();
    else startListening();
  }
  listenBtn.addEventListener('click', toggleListen);
  listenBtn.addEventListener('touchstart', toggleListen, { passive: false });
  stopBtn.addEventListener('click', stopSpeaking);
  stopBtn.addEventListener('touchstart', e => { e.preventDefault(); stopSpeaking(); }, { passive: false });
  clearBtn.addEventListener('click', clearHistory);

  // Text input fallback
  const textInput = $('textInput');
  const sendBtn   = $('sendBtn');
  if (textInput && sendBtn) {
    function sendText() {
      const t = textInput.value.trim();
      if (t) { handleCommand(t, true); textInput.value = ''; }
    }
    sendBtn.addEventListener('click', sendText);
    textInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
  }
}

function setupKeyboardShortcut() {
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (STATE.isListening) stopListening();
      else startListening();
    }
    if (e.key === 'Escape') {
      stopListening();
      stopSpeaking();
    }
  });
}

function setupChips() {
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      handleCommand(cmd, true);
    });
  });
}

// ── Speech Recognition ─────────────────────────────
function startListening() {
  // Browser support check
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    const msg = "⚠ Voice not supported. Use Google Chrome or Edge. You can still TYPE commands in the box below!";
    showResponse(msg); speak(msg); return;
  }

  // Warn if running on file://
  if (window.location.protocol === 'file:') {
    const msg = "⚠ Mic blocked on local file! Open via http://localhost:8000";
    showResponse(msg); return;
  }

  // On mobile, mic only works on HTTPS (not http://192.x.x.x)
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    const msg = "⚠ On phone, mic needs HTTPS. Use the TYPE box below to send commands — it works fully!";
    showResponse(msg); speak("Please use the text input box below to type your command, sir."); return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  STATE.recognition = new SpeechRecognition();
  STATE.recognition.lang = 'en-US';
  STATE.recognition.interimResults = true;
  STATE.recognition.maxAlternatives = 1;

  STATE.isListening = true;
  listenBtn.classList.add('listening');
  arcReactor.classList.add('listening');
  setWaveActive(true);
  setStatus('LISTENING...', 'listening');
  setArcProgress(100);
  transcriptEl.textContent = 'Listening...';

  STATE.recognition.onresult = (evt) => {
    let interim = '', final = '';
    for (let i = evt.resultIndex; i < evt.results.length; i++) {
      if (evt.results[i].isFinal) final += evt.results[i][0].transcript;
      else interim += evt.results[i][0].transcript;
    }
    transcriptEl.textContent = final || interim || 'Listening...';
    if (final) handleCommand(final.trim());
  };

  STATE.recognition.onerror = (evt) => {
    const errMap = {
      'not-allowed':        '⚠ Microphone permission denied. Click the 🔒 lock icon in your browser address bar and allow microphone, then refresh.',
      'service-not-allowed':'⚠ Mic blocked on local file. Open via http://localhost:8000 instead (run: python -m http.server 8000)',
      'network':            '⚠ Network error — Speech recognition needs internet. Check your connection.',
      'no-speech':          '🔇 No speech detected. Please try again and speak clearly.',
      'audio-capture':      '⚠ No microphone found. Please plug in a mic and try again.',
      'aborted':            null,  // silent, user triggered
    };
    const userMsg = errMap[evt.error] || `⚠ Speech error: ${evt.error}`;
    if (userMsg) {
      setStatus('MIC ERROR', 'error');
      showResponse(userMsg);
      console.error('Speech recognition error:', evt.error);
    }
    stopListening(false);
  };

  STATE.recognition.onend = () => stopListening(false);

  try { STATE.recognition.start(); }
  catch (e) { console.warn('Recognition already started'); }
}

function stopListening(abort = true) {
  STATE.isListening = false;
  listenBtn.classList.remove('listening');
  arcReactor.classList.remove('listening');
  setWaveActive(false);
  setArcProgress(0);
  if (abort && STATE.recognition) {
    try { STATE.recognition.abort(); } catch(e) {}
  }
  if (!STATE.isSpeaking) setStatus('STANDBY', 'online');
}

// ── Command Handling ───────────────────────────────
async function handleCommand(text, fromChip = false) {
  if (!text) return;
  if (fromChip) transcriptEl.textContent = text;

  addToHistory('user', text);
  setStatus('PROCESSING...', 'online');

  // Built-in commands first
  const res = await runBuiltIn(text.toLowerCase());
  if (res !== null) {
    showResponse(res);
    speak(res);
    addToHistory('jarvis', res);
    return;
  }

  // AI fallback
  if (!STATE.apiKey) {
    const msg = "I need a Gemini API key to answer that. Please enter it in the API panel above.";
    showResponse(msg);
    speak(msg);
    addToHistory('jarvis', msg);
    return;
  }

  try {
    const reply = await callGemini(text);
    showResponse(reply);
    speak(reply);
    addToHistory('jarvis', reply);
  } catch (err) {
    const errMsg = `⚠ ${err.message}`;
    showResponse(errMsg);
    speak("I encountered an error processing that request, sir.");
    addToHistory('jarvis', errMsg);
  }
}

// ── Safe Link Opener (never navigates Jarvis away) ──
function openLink(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { if (a.parentNode) a.parentNode.removeChild(a); }, 300);
}

// ── Built-in Commands ──────────────────────────────
async function runBuiltIn(q) {
  const now = new Date();

  // Time
  if (/\b(time)\b/.test(q)) {
    const t = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `The current time is ${t}, sir.`;
  }

  // Date
  if (/\b(date|today|day)\b/.test(q)) {
    const d = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `Today is ${d}, sir.`;
  }

  // Open YouTube
  if (/open youtube/i.test(q)) {
    openLink('https://www.youtube.com');
    return "Opening YouTube for you, sir.";
  }

  // Open Google
  if (/open google(?! maps)/i.test(q)) {
    openLink('https://www.google.com');
    return "Opening Google, sir.";
  }

  // Google search
  if (/search (for |google )?(.*)/i.test(q)) {
    const match = q.match(/search (?:for |google )?(.+)/i);
    if (match && match[1]) {
      openLink(`https://www.google.com/search?q=${encodeURIComponent(match[1])}`);
      return `Searching Google for "${match[1]}", sir.`;
    }
  }

  // Open GitHub
  if (/open github/i.test(q)) {
    openLink('https://github.com');
    return "Opening GitHub, sir.";
  }

  // Open WhatsApp — universal link opens app on phone automatically
  if (/whatsapp/i.test(q)) {
    openLink('https://wa.me/');
    return "Opening WhatsApp, sir.";
  }

  // Open Gmail
  if (/gmail|email/i.test(q) && /open/i.test(q)) {
    openLink('https://mail.google.com');
    return "Opening Gmail, sir.";
  }

  // Open Maps
  if (/maps/i.test(q)) {
    openLink('https://maps.google.com');
    return "Opening Google Maps, sir.";
  }

  // Open Instagram
  if (/instagram/i.test(q)) {
    openLink('https://www.instagram.com');
    return "Opening Instagram, sir.";
  }

  // Open Twitter / X
  if (/twitter|\bx\.com\b/i.test(q)) {
    openLink('https://twitter.com');
    return "Opening Twitter, sir.";
  }

  // Open Spotify
  if (/spotify/i.test(q)) {
    openLink('https://open.spotify.com');
    return "Opening Spotify, sir.";
  }

  // Joke
  if (/joke|funny|laugh/i.test(q)) {
    const jokes = [
      "Why don't scientists trust atoms? Because they make up everything.",
      "I told my wife she was drawing her eyebrows too high. She looked surprised.",
      "Why do programmers prefer dark mode? Because light attracts bugs.",
      "Why did the scarecrow win an award? Because he was outstanding in his field.",
      "I'm reading a book about anti-gravity. It's impossible to put down.",
      "Why do Java developers wear glasses? Because they don't C#.",
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }

  // Music / Play song — opens YouTube (phone auto-opens YouTube app)
  if (/^play\b/i.test(q)) {
    // Extract song name robustly
    const songName = q
      .replace(/^play\s+/i, '')
      .replace(/\s+(on\s+)?(youtube|spotify|music|song|gaana|gana)\s*$/i, '')
      .trim();
    if (songName) {
      const encoded = encodeURIComponent(songName + ' official song');
      // YouTube link works as universal link — opens YouTube app on phone
      openLink(`https://www.youtube.com/results?search_query=${encoded}`);
      return `Playing "${songName}" on YouTube, sir.`;
    }
  }

  // Help
  if (/what can you do|help|capabilities|commands/i.test(q)) {
    return `I can help you with: checking the time and date, opening websites like YouTube, Google, GitHub, WhatsApp, Gmail and Google Maps, searching the web, playing music on YouTube, telling jokes, and answering any question using my Gemini AI brain. Just ask away, sir!`;
  }

  // Who are you
  if (/who are you|your name|what are you/i.test(q)) {
    return "I am J.A.R.V.I.S — Just A Rather Very Intelligent System. Your personal AI assistant, at your service, sir.";
  }

  // How are you
  if (/how are you|are you ok/i.test(q)) {
    return "All systems nominal. Operating at peak efficiency. How can I assist you today, sir?";
  }

  // Goodbye
  if (/goodbye|bye|exit|shutdown|go to sleep/i.test(q)) {
    return "Goodbye, sir. J.A.R.V.I.S standing by. Stay brilliant.";
  }

  // Weather
  if (/weather|temperature|forecast/i.test(q)) {
    const cityMatch = q.match(/weather (?:in |for )?(.+)/i);
    if (cityMatch) {
      openLink(`https://www.google.com/search?q=weather+${encodeURIComponent(cityMatch[1].trim())}`);
      return `Checking weather for ${cityMatch[1]}, sir.`;
    }
    openLink('https://www.google.com/search?q=weather');
    return "Checking current weather for you, sir.";
  }

  // Math
  const mathMatch = q.match(/(?:calculate|compute|what is|solve)?\s*([\d\s\+\-\*\/\^\(\)\.]+)$/i);
  if (mathMatch && /[\+\-\*\/]/.test(mathMatch[1])) {
    try {
      const result = Function('"use strict"; return (' + mathMatch[1] + ')')();
      if (!isNaN(result)) return `The result of ${mathMatch[1].trim()} is ${result}, sir.`;
    } catch(e) {}
  }

  return null; // Not a built-in command
}

// ── Gemini AI ──────────────────────────────────────
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${STATE.geminiModel}:generateContent?key=${STATE.apiKey}`;

  const systemInstruction = `You are J.A.R.V.I.S (Just A Rather Very Intelligent System), a sophisticated AI assistant inspired by Tony Stark's AI from Iron Man. 
  Respond in character: professional, precise, slightly formal, and occasionally witty. 
  Keep responses concise (2-4 sentences max for simple questions). 
  Always address the user as "sir". 
  Never break character.`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 400,
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error?.message || `API Error ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "I couldn't generate a response at this time, sir.";
}

// ── Text-to-Speech ─────────────────────────────────
function speak(text) {
  if (!STATE.synth) return;
  stopSpeaking();

  // Strip markdown-like symbols for cleaner speech
  const clean = text.replace(/[#*`_>\-]+/g, '').replace(/\s+/g, ' ').trim();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.0;
  utterance.pitch = 0.85;
  utterance.volume = 1.0;

  // Try to find a good voice
  const voices = STATE.synth.getVoices();
  const preferred = voices.find(v =>
    /google uk english male|daniel|alex|microsoft david/i.test(v.name)
  ) || voices.find(v => v.lang === 'en-US' && v.name.includes('Male'))
    || voices.find(v => v.lang === 'en-US')
    || voices[0];

  if (preferred) utterance.voice = preferred;

  utterance.onstart = () => {
    STATE.isSpeaking = true;
    setStatus('SPEAKING', 'speaking');
    setWaveActive(true);
    setArcProgress(75);
  };

  utterance.onend = utterance.onerror = () => {
    STATE.isSpeaking = false;
    setWaveActive(false);
    setArcProgress(0);
    if (!STATE.isListening) setStatus('STANDBY', 'online');
  };

  STATE.currentUtterance = utterance;
  STATE.synth.speak(utterance);
}

function stopSpeaking() {
  if (STATE.synth.speaking) {
    STATE.synth.cancel();
  }
  STATE.isSpeaking = false;
  setWaveActive(false);
  setArcProgress(0);
  if (!STATE.isListening) setStatus('STANDBY', 'online');
}

// Voices load async — need this for some browsers
if (STATE.synth.onvoiceschanged !== undefined) {
  STATE.synth.onvoiceschanged = () => STATE.synth.getVoices();
}

// ── UI Helpers ─────────────────────────────────────
function showResponse(text) {
  responseEl.classList.add('typing');
  responseEl.textContent = '';

  // Typewriter effect
  let i = 0;
  const chars = text.split('');
  const speed = Math.max(15, Math.min(40, 2000 / chars.length));

  function type() {
    if (i < chars.length) {
      responseEl.textContent += chars[i++];
      setTimeout(type, speed);
    } else {
      responseEl.classList.remove('typing');
    }
  }
  type();
}

function addToHistory(role, text) {
  STATE.history.push({ role, text, time: new Date().toLocaleTimeString() });

  // Remove empty state
  const empty = historyList.querySelector('.history-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `history-entry ${role === 'user' ? 'user-entry' : 'jarvis-entry'}`;
  entry.innerHTML = `
    <div class="history-label">${role === 'user' ? '👤 YOU' : '🤖 JARVIS'}</div>
    <div class="history-content">${escapeHtml(text)}</div>
  `;
  historyList.appendChild(entry);
  historyList.scrollTop = historyList.scrollHeight;

  historyCount.textContent = `${STATE.history.filter(h => h.role === 'user').length} entries`;
}

function clearHistory() {
  STATE.history = [];
  historyList.innerHTML = '<div class="history-empty">No conversation yet. Start talking!</div>';
  historyCount.textContent = '0 entries';
  transcriptEl.innerHTML = 'Press the button below or say <em>"Hey Jarvis"</em> to begin...';
  responseEl.textContent = 'Awaiting your command, sir.';
  responseEl.classList.remove('typing');
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
