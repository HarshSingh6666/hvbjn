/* =====================================================
   J.A.R.V.I.S — Voice Assistant Script
   System Control Edition (Python Backend)
   ===================================================== */

// ── Backend Config ──────────────────────────────────
const BACKEND = 'http://localhost:3000';  // Python Flask server
let backendOnline = false;

// Check if backend is running
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/api/contacts`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      backendOnline = true;
      setStatus('ONLINE — FULL POWER', 'online');
      
      // Load API key from backend
      try {
        const confRes = await fetch(`${BACKEND}/api/config`);
        const conf = await confRes.json();
        if (conf.apiKey) {
          STATE.apiKey = conf.apiKey;
          $('apiKeyInput').value = '●'.repeat(20);
        }
      } catch (e) {
        console.warn('Could not fetch API config');
      }
    }
  } catch {
    backendOnline = false;
    console.warn('Backend offline — system commands disabled.');
  }
}

// Call backend helper
async function callBackend(endpoint, body = {}) {
  const res = await fetch(`${BACKEND}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data;
}

// Contacts cache
let contactsCache = {};
async function loadContacts() {
  try {
    const res = await fetch(`${BACKEND}/api/contacts`, { signal: AbortSignal.timeout(1500) });
    contactsCache = await res.json();
  } catch { /* offline */ }
}

// ── State ──────────────────────────────────────────
const STATE = {
  apiKey: 'AIzaSyCEX1O78N9aO58bXKjlFMD60EU4REDLzIA',
  geminiModel: 'gemini-2.5-flash',
  isListening: false,
  isSpeaking: false,
  history: [],
  recognition: null,
  synth: window.speechSynthesis,
  currentUtterance: null,
  pendingWhatsApp: null,  // for multi-turn: waiting for number
};

// ── DOM Refs ───────────────────────────────────────
const $ = id => document.getElementById(id);
const listenBtn = $('listenBtn');
const stopBtn = $('stopBtn');
const clearBtn = $('clearBtn');
const transcriptEl = $('transcriptText');
const responseEl = $('responseText');
const statusDot = $('statusDot');
const statusText = $('statusText');
const stateLabel = $('stateLabelText');
const arcProgress = $('arcProgress');
const arcReactor = $('arcReactor');
const waveform = $('waveform');
const historyList = $('historyList');
const historyCount = $('historyCount');
const clockEl = $('clockDisplay');
const apiKeyInput = $('apiKeyInput');
const saveApiBtn = $('saveApiBtn');
const chips = document.querySelectorAll('.chip');

// ── Init ───────────────────────────────────────────
(async function init() {
  spawnParticles();
  buildWaveform();
  startClock();
  setupApiPanel();
  setupButtons();
  setupKeyboardShortcut();
  setupChips();
  setupContactsModal();

  apiKeyInput.value = '●'.repeat(20);
  setStatus('BOOTING...', 'online');

  await checkBackend();
  await loadContacts();

  if (backendOnline) {
    speak("J.A.R.V.I.S online with full system control. Welcome back, sir.");
  } else {
    speak("J.A.R.V.I.S online. Start the Python server for full system control, sir.");
  }
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
  const sendBtn = $('sendBtn');
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

// ── Contacts Modal ─────────────────────────────────
function setupContactsModal() {
  const modal = $('contactsModal');
  const closeBtn = $('modalClose');
  const addBtn = $('addContactBtn');
  const nameIn = $('contactName');
  const numIn = $('contactNumber');

  if (!modal) return;

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  addBtn.addEventListener('click', async () => {
    const name = nameIn.value.trim();
    const number = numIn.value.trim();
    if (!name || !number) { alert('Please enter both name and number'); return; }
    try {
      const res = await fetch(`${BACKEND}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, number }),
      });
      const data = await res.json();
      if (data.success) {
        await loadContacts();
        renderContactsList();
        nameIn.value = numIn.value = '';
        speak(`Contact ${name} saved, sir.`);
      }
    } catch {
      alert('Backend offline. Start server.py first!');
    }
  });
}

function openContactsModal() {
  const modal = $('contactsModal');
  if (!modal) return;
  renderContactsList();
  modal.classList.add('open');
}

function renderContactsList() {
  const list = $('contactsList');
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(contactsCache);
  if (entries.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:.85rem;">No contacts yet. Add some below!</p>';
    return;
  }
  entries.forEach(([name, number]) => {
    const row = document.createElement('div');
    row.className = 'contact-row';
    row.innerHTML = `
      <span class="contact-name">👤 ${name}</span>
      <span class="contact-num">+${number}</span>
      <button class="contact-del" title="Delete" onclick="deleteContact('${name}')">✕</button>
    `;
    list.appendChild(row);
  });
}

async function deleteContact(name) {
  try {
    await fetch(`${BACKEND}/api/contacts/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await loadContacts();
    renderContactsList();
    speak(`Contact ${name} deleted, sir.`);
  } catch {
    alert('Backend offline.');
  }
}

// ── Speech Recognition ─────────────────────────────
function startListening() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    const msg = "⚠ Voice not supported. Use Google Chrome or Edge. You can still TYPE commands in the box below!";
    showResponse(msg); speak(msg); return;
  }

  if (window.location.protocol === 'file:') {
    const msg = "⚠ Mic blocked on local file! Open via http://localhost:3000 (run server.py first)";
    showResponse(msg); return;
  }

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    const msg = "⚠ On phone, mic needs HTTPS. Use the TYPE box below.";
    showResponse(msg); speak("Please use the text input box below, sir."); return;
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
      'not-allowed': '⚠ Microphone permission denied. Click the 🔒 lock icon and allow microphone.',
      'service-not-allowed': '⚠ Mic blocked. Open via http://localhost:3000',
      'network': '⚠ Network error — Speech recognition needs internet.',
      'no-speech': '🔇 No speech detected. Try again.',
      'audio-capture': '⚠ No microphone found.',
      'aborted': null,
    };
    const userMsg = errMap[evt.error] || `⚠ Speech error: ${evt.error}`;
    if (userMsg) { setStatus('MIC ERROR', 'error'); showResponse(userMsg); }
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
    try { STATE.recognition.abort(); } catch (e) { }
  }
  if (!STATE.isSpeaking) setStatus('STANDBY', 'online');
}

// ── Command Handling ───────────────────────────────
async function handleCommand(text, fromChip = false) {
  if (!text) return;
  if (fromChip) transcriptEl.textContent = text;

  addToHistory('user', text);
  setStatus('PROCESSING...', 'online');

  // Multi-turn: waiting for a phone number after unknown contact
  if (STATE.pendingWhatsApp) {
    const number = text.replace(/\D/g, '');
    if (number.length >= 7) {
      const { name, message } = STATE.pendingWhatsApp;
      STATE.pendingWhatsApp = null;
      try {
        const data = await callBackend('/api/whatsapp', { number, message });
        const reply = data.message || `Opening WhatsApp for ${name}, sir.`;
        showResponse(reply); speak(reply); addToHistory('jarvis', reply);
      } catch {
        const err = "Could not reach backend. Make sure server.py is running, sir.";
        showResponse(err); speak(err); addToHistory('jarvis', err);
      }
    } else {
      const ask = "I didn't catch a valid number. Please say or type the phone number with country code.";
      showResponse(ask); speak(ask); addToHistory('jarvis', ask);
    }
    return;
  }

  // Built-in commands first
  const res = await runBuiltIn(text.toLowerCase(), text);
  if (res !== null) {
    showResponse(res);
    speak(res);
    addToHistory('jarvis', res);
    return;
  }

  // AI fallback
  if (!STATE.apiKey) {
    const msg = "I need a Gemini API key to answer that.";
    showResponse(msg); speak(msg); addToHistory('jarvis', msg);
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
    speak("I encountered an error, sir.");
    addToHistory('jarvis', errMsg);
  }
}

// ── Safe Link Opener ───────────────────────────────
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

// Helper: call system endpoint
async function sysCmd(action) {
  if (!backendOnline) return "Backend offline. Please start server.py first, sir.";
  try {
    const data = await callBackend('/api/system', { action });
    return data.message || 'Done, sir.';
  } catch {
    return "Could not reach backend, sir.";
  }
}

// Helper: call open-app endpoint
async function openApp(appName) {
  if (!backendOnline) return `Backend offline. Cannot open ${appName}, sir.`;
  try {
    const data = await callBackend('/api/open-app', { app: appName });
    return data.message || `Opening ${appName}, sir.`;
  } catch {
    return "Could not reach backend, sir.";
  }
}

// ── Built-in Commands ──────────────────────────────
async function runBuiltIn(q, raw) {
  const now = new Date();

  // ── Time ──
  if (/\b(time)\b/.test(q)) {
    const t = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `The current time is ${t}, sir.`;
  }

  // ── Date ──
  if (/\b(date|today|day)\b/.test(q)) {
    const d = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return `Today is ${d}, sir.`;
  }

  // ── WhatsApp message to a contact ──
  // Supported natural patterns:
  //   "send message to Mom that hello"
  //   "send a message to Rahul saying good morning"
  //   "message Dad that I am coming"
  //   "WhatsApp Mom hello how are you"
  //   "send WhatsApp to Dad saying I'm coming"
  //   "tell Rahul on WhatsApp that I will be late"
  //   "message to Mom on WhatsApp good morning"

  let waName = null, waMessage = null;

  // Skip "open whatsapp" — handled separately below
  const isOpenWhatsApp = /^open\s+whatsapp$/i.test(raw.trim());

  // Pattern 1: send [a] [whatsapp] message to <name> [saying/that/tell/say/:] <msg>
  if (!isOpenWhatsApp) {
    let m = raw.match(/send\s+(?:a\s+)?(?:whatsapp\s+)?(?:message|msg)\s+to\s+([\w\s]+?)\s+(?:saying|that|say|tell|:|,|-)\s+(.+)/i);
    if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }

    // Pattern 2: send whatsapp to <name> [saying/that] <msg>
    if (!waName) {
      m = raw.match(/send\s+(?:a\s+)?whatsapp\s+to\s+([\w\s]+?)\s+(?:saying|that|say|,|-|:)\s+(.+)/i);
      if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }
    }

    // Pattern 3: message [to] <name> [on whatsapp] [saying/that] <msg>
    if (!waName) {
      m = raw.match(/^message\s+(?:to\s+)?([\w\s]+?)\s+(?:on\s+whatsapp\s+)?(?:saying|that|say|,|-|:)\s+(.+)/i);
      if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }
    }

    // Pattern 4: tell <name> on whatsapp [that/saying] <msg>
    if (!waName) {
      m = raw.match(/tell\s+([\w\s]+?)\s+on\s+whatsapp\s+(?:that\s+|saying\s+)?(.+)/i);
      if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }
    }

    // Pattern 5: whatsapp <name> [saying/that] <msg>  (e.g. "whatsapp Mom hello")
    if (!waName) {
      m = raw.match(/^whatsapp\s+([\w\s]+?)\s+(?:saying\s+|that\s+)?(.+)/i);
      if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }
    }

    // Pattern 6: message <name> [that/saying] <msg>  (e.g. "message Rahul that good morning")
    if (!waName) {
      m = raw.match(/^message\s+([\w]+(?:\s[\w]+)?)\s+(?:that\s+|saying\s+)(.+)/i);
      if (m) { waName = m[1].trim(); waMessage = m[2].trim(); }
    }
  }

  if (waName && waMessage) {
    const name = waName.toLowerCase();
    const message = waMessage;
    const number = contactsCache[name];

    if (!backendOnline) return "Backend offline. Start server.py to send WhatsApp messages, sir.";

    if (number) {
      try {
        const data = await callBackend('/api/whatsapp', { number, message, autoSend: true });
        return data.message || `Sending WhatsApp message to ${name}, sir.`;
      } catch {
        return "Could not reach backend, sir.";
      }
    } else {
      // Ask for number — multi-turn
      STATE.pendingWhatsApp = { name, message };
      const ask = `I don't have ${name}'s number in my contacts, sir. Please tell me their phone number with country code.`;
      return ask;
    }
  }

  // ── Open WhatsApp (no message) ──
  if (/open whatsapp/i.test(q)) {
    openLink('whatsapp://');
    return "Opening WhatsApp Desktop, sir.";
  }

  // ── Open YouTube ──
  if (/open youtube/i.test(q)) {
    openLink('https://www.youtube.com');
    return "Opening YouTube for you, sir.";
  }

  // ── Open Google ──
  if (/open google(?! maps)/i.test(q)) {
    openLink('https://www.google.com');
    return "Opening Google, sir.";
  }

  // ── Google search ──
  if (/search (for |google )?(.*)/.test(q)) {
    const match = raw.match(/search (?:for |google )?(.+)/i);
    if (match && match[1]) {
      openLink(`https://www.google.com/search?q=${encodeURIComponent(match[1])}`);
      return `Searching Google for "${match[1]}", sir.`;
    }
  }

  // ── Open GitHub ──
  if (/open github/i.test(q)) {
    openLink('https://github.com');
    return "Opening GitHub, sir.";
  }

  // ── Play music ──
  if (/^play\b/i.test(q)) {
    const songName = q.replace(/^play\s+/i, '').replace(/\s+(on\s+)?(youtube|spotify|music|song|gaana|gana)\s*$/i, '').trim();
    if (songName) {
      const encoded = encodeURIComponent(songName + ' official song');
      openLink(`https://www.youtube.com/results?search_query=${encoded}`);
      return `Playing "${songName}" on YouTube, sir.`;
    }
  }

  // ── Open app on Windows ──
  const openAppMatch = raw.match(/open\s+(.+)/i);
  if (openAppMatch) {
    const appName = openAppMatch[1].trim().toLowerCase();
    // Exclude web-only apps (already handled above)
    const webOnlyApps = ['youtube', 'google', 'github', 'whatsapp', 'gmail', 'maps', 'instagram', 'twitter', 'spotify website'];
    if (!webOnlyApps.some(w => appName.includes(w))) {
      return await openApp(appName);
    }
  }

  // ── Gmail / Email ──
  if (/gmail|email/i.test(q) && /open/i.test(q)) {
    openLink('https://mail.google.com');
    return "Opening Gmail, sir.";
  }

  // ── Maps ──
  if (/maps/i.test(q)) {
    openLink('https://maps.google.com');
    return "Opening Google Maps, sir.";
  }

  // ── Instagram ──
  if (/instagram/i.test(q)) {
    openLink('https://www.instagram.com');
    return "Opening Instagram, sir.";
  }

  // ── Twitter / X ──
  if (/twitter|\bx\.com\b/i.test(q)) {
    openLink('https://twitter.com');
    return "Opening Twitter, sir.";
  }

  // ── Volume Up ──
  if (/volume up|increase volume|louder|vol up/i.test(q)) {
    return await sysCmd('volume-up');
  }

  // ── Volume Down ──
  if (/volume down|decrease volume|quieter|lower volume|vol down/i.test(q)) {
    return await sysCmd('volume-down');
  }

  // ── Mute ──
  if (/\bmute\b|\bunmute\b/i.test(q)) {
    return await sysCmd('mute');
  }

  // ── Brightness ──
  if (/brightness up|increase brightness|brighter/i.test(q)) {
    return await sysCmd('brightness-up');
  }
  if (/brightness down|decrease brightness|dimm?er/i.test(q)) {
    return await sysCmd('brightness-down');
  }

  // ── Lock PC ──
  if (/lock (computer|pc|screen|workstation)|lock it/i.test(q)) {
    return await sysCmd('lock');
  }

  // ── Shutdown ──
  if (/shutdown|shut down|turn off (computer|pc)/i.test(q)) {
    return await sysCmd('shutdown');
  }

  // ── Cancel shutdown ──
  if (/cancel shutdown/i.test(q)) {
    return await sysCmd('cancel-shutdown');
  }

  // ── Restart ──
  if (/restart|reboot/i.test(q)) {
    return await sysCmd('restart');
  }

  // ── Sleep ──
  if (/sleep|hibernate/i.test(q)) {
    return await sysCmd('sleep');
  }

  // ── Screenshot ──
  if (/screenshot|capture screen|screen capture/i.test(q)) {
    return await sysCmd('screenshot');
  }

  // ── Show contacts ──
  if (/show contacts|open contacts|my contacts/i.test(q)) {
    openContactsModal();
    return "Opening contacts manager, sir.";
  }

  // ── Add contact ──
  const addContactMatch = raw.match(/add contact\s+(\w[\w\s]*?)\s+(?:number|num|phone|at|is)\s+([\d\+\s\-]+)/i);
  if (addContactMatch) {
    const name = addContactMatch[1].trim();
    const number = addContactMatch[2].replace(/\D/g, '');
    if (!backendOnline) return "Backend offline. Cannot save contact, sir.";
    try {
      const res = await fetch(`${BACKEND}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, number }),
      });
      const data = await res.json();
      if (data.success) {
        await loadContacts();
        return `Contact ${name} saved with number ${number}, sir.`;
      }
    } catch { return "Could not save contact, sir."; }
  }

  // ── Joke ──
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

  // ── Help ──
  if (/what can you do|help|capabilities|commands/i.test(q)) {
    return `Sir, here is what I can do: ✦ Open any Windows app — "open notepad", "open chrome" ✦ Send WhatsApp messages — "send message to Mom saying hello" ✦ System control — "volume up", "volume down", "mute", "lock computer", "shutdown", "restart", "screenshot" ✦ Brightness — "brightness up", "brightness down" ✦ Contacts — "add contact Mom number 919876543210", "show contacts" ✦ Web — YouTube, Google, search, Gmail, Maps, Instagram ✦ Music — "play kesariya on youtube" ✦ AI brain — ask me anything! ✦ Weather — "weather in Delhi"`;
  }

  // ── Who are you ──
  if (/who are you|your name|what are you/i.test(q)) {
    return "I am J.A.R.V.I.S — Just A Rather Very Intelligent System. Your personal AI assistant with full Windows system control, sir.";
  }

  // ── How are you ──
  if (/how are you|are you ok/i.test(q)) {
    return "All systems nominal. Operating at peak efficiency. How can I assist you today, sir?";
  }

  // ── Goodbye ──
  if (/goodbye|bye|exit|shutdown jarvis|go to sleep/i.test(q)) {
    return "Goodbye, sir. J.A.R.V.I.S standing by. Stay brilliant.";
  }

  // ── Weather ──
  if (/weather|temperature|forecast/i.test(q)) {
    const cityMatch = raw.match(/weather (?:in |for )?(.+)/i);
    if (cityMatch) {
      openLink(`https://www.google.com/search?q=weather+${encodeURIComponent(cityMatch[1].trim())}`);
      return `Checking weather for ${cityMatch[1]}, sir.`;
    }
    openLink('https://www.google.com/search?q=weather');
    return "Checking current weather for you, sir.";
  }

  // ── Math ──
  const mathMatch = q.match(/(?:calculate|compute|what is|solve)?\s*([\d\s\+\-\*\/\^\(\)\.]+)$/i);
  if (mathMatch && /[\+\-\*\/]/.test(mathMatch[1])) {
    try {
      const result = Function('"use strict"; return (' + mathMatch[1] + ')')();
      if (!isNaN(result)) return `The result of ${mathMatch[1].trim()} is ${result}, sir.`;
    } catch (e) { }
  }

  return null;
}

// ── Gemini AI ──────────────────────────────────────
async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${STATE.geminiModel}:generateContent?key=${STATE.apiKey}`;

  const systemInstruction = `You are J.A.R.V.I.S (Just A Rather Very Intelligent System), a sophisticated AI assistant with full Windows PC control powers, inspired by Tony Stark's AI from Iron Man. 
  Respond in character: professional, precise, slightly formal, and occasionally witty. 
  Keep responses concise (2-4 sentences max for simple questions). 
  Always address the user as "sir". 
  Never break character.`;

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 400 }
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

  const clean = text.replace(/[#*`_>\-✦]+/g, '').replace(/\s+/g, ' ').trim();

  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.0;
  utterance.pitch = 0.85;
  utterance.volume = 1.0;

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
  if (STATE.synth.speaking) STATE.synth.cancel();
  STATE.isSpeaking = false;
  setWaveActive(false);
  setArcProgress(0);
  if (!STATE.isListening) setStatus('STANDBY', 'online');
}

if (STATE.synth.onvoiceschanged !== undefined) {
  STATE.synth.onvoiceschanged = () => STATE.synth.getVoices();
}

// ── UI Helpers ─────────────────────────────────────
function showResponse(text) {
  responseEl.classList.add('typing');
  responseEl.textContent = '';

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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
