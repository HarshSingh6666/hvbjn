"""
J.A.R.V.I.S — Always-On Background Listener
=============================================
Run this script alongside server.py to enable always-on voice control.

  python background_jarvis.py

Say "Jarvis" or "Hey Jarvis" to wake up, then give your command.
Jarvis will respond via text-to-speech and carry out actions in the background.
"""

import speech_recognition as sr
import pyttsx3
import requests
import json
import time
import re
import threading
import sys
import urllib.parse
import webbrowser
import os
import datetime

BACKEND = "http://localhost:3000"
WAKE_WORDS = ["jarvis", "hey jarvis", "ok jarvis", "hi jarvis"]

# ─── TTS Engine ─────────────────────────────────────────────────────
_tts_lock = threading.Lock()
_engine = pyttsx3.init()
_engine.setProperty('rate', 160)
_engine.setProperty('volume', 1.0)

# Pick a male voice if available
voices = _engine.getProperty('voices')
for v in voices:
    if any(k in v.name.lower() for k in ['male', 'david', 'mark', 'zira']):
        if 'zira' not in v.name.lower():          # prefer male over Zira (female)
            _engine.setProperty('voice', v.id)
            break

def speak(text: str):
    """Speak text aloud using pyttsx3. Thread-safe."""
    clean = re.sub(r'[#*`_>\-✦]+', '', text).strip()
    print(f"\n🤖 JARVIS: {clean}\n")
    with _tts_lock:
        _engine.say(clean)
        _engine.runAndWait()

# ─── Contacts ────────────────────────────────────────────────────────
_contacts: dict = {}

def load_contacts():
    global _contacts
    try:
        r = requests.get(f"{BACKEND}/api/contacts", timeout=3)
        _contacts = r.json()
    except Exception:
        # Try reading from file directly as fallback
        try:
            base = os.path.dirname(os.path.abspath(__file__))
            with open(os.path.join(base, "contacts.json"), "r", encoding="utf-8") as f:
                _contacts = json.load(f)
        except Exception:
            _contacts = {}

# ─── WhatsApp Auto-Send ──────────────────────────────────────────────
def send_whatsapp(number: str, message: str, contact_name: str = "") -> str:
    """Send a WhatsApp message automatically using the WhatsApp Desktop app."""
    try:
        import pyautogui
        # number must start with + and country code
        phone = f"+{number}" if not number.startswith("+") else number
        print(f"📱 Opening WhatsApp Desktop for {phone}...")
        
        # 1. Open WhatsApp Desktop directly to the chat (without pre-filling text)
        wa_url = f"whatsapp://send?phone={phone}"
        os.startfile(wa_url)
        
        # 2. Wait for the app to open and focus natively
        print("⏳ Waiting 6 seconds for WhatsApp Desktop to load...")
        time.sleep(6)
        
        # 3. Type the message step-by-step visually
        print(f"⌨️  Typing message: {message}")
        pyautogui.write(message, interval=0.04)
        time.sleep(1) # slight pause before sending
        
        # 4. Press Enter to send
        print("🚀 Pressing Enter to send...")
        pyautogui.press('enter')
        
        name = contact_name or number
        return f"Message sent to {name} via WhatsApp Desktop, sir."
    except Exception as e:
        print(f"Error auto-sending via Desktop app: {e}")
        return f"Could not auto-send to {contact_name or number}, sir."

# ─── Command Processor ───────────────────────────────────────────────
def process_command(raw: str) -> str:
    """Process a voice command and return the response text."""
    q = raw.lower().strip()
    now = datetime.datetime.now()

    # ── Time ──
    if re.search(r'\btime\b', q):
        return f"The current time is {now.strftime('%I:%M %p')}, sir."

    # ── Date ──
    if re.search(r'\b(date|today|day)\b', q):
        return f"Today is {now.strftime('%A, %d %B %Y')}, sir."

    # ── WhatsApp message ──
    wa_name, wa_msg = None, None
    patterns = [
        r'send\s+(?:a\s+)?(?:whatsapp\s+)?(?:message|msg)\s+to\s+([\w\s]+?)\s+(?:saying|that|say|tell|:|,|-)\s+(.+)',
        r'send\s+(?:a\s+)?whatsapp\s+to\s+([\w\s]+?)\s+(?:saying|that|say|,|-|:)\s+(.+)',
        r'^message\s+(?:to\s+)?([\w\s]+?)\s+(?:on\s+whatsapp\s+)?(?:saying|that|say|,|-|:)\s+(.+)',
        r'tell\s+([\w\s]+?)\s+on\s+whatsapp\s+(?:that\s+|saying\s+)?(.+)',
        r'^whatsapp\s+([\w\s]+?)\s+(?:saying\s+|that\s+)?(.+)',
        r'^message\s+([\w]+(?:\s[\w]+)?)\s+(?:that\s+|saying\s+)(.+)',
    ]
    if not re.match(r'^open\s+whatsapp$', q):
        for pat in patterns:
            m = re.match(pat, raw, re.IGNORECASE)
            if m:
                wa_name = m.group(1).strip().lower()
                wa_msg  = m.group(2).strip()
                break

    if wa_name and wa_msg:
        number = _contacts.get(wa_name)
        if number:
            # Send in a background thread so Jarvis responds immediately
            def _send():
                result = send_whatsapp(number, wa_msg, wa_name)
                speak(result)
            threading.Thread(target=_send, daemon=True).start()
            return f"Sending message to {wa_name} on WhatsApp now, sir. Please wait a moment."
        else:
            return f"I don't have {wa_name}'s number in my contacts, sir. Please add them first."

    # ── Open WhatsApp ──
    if re.search(r'open\s+whatsapp', q):
        try:
            r = requests.post(f"{BACKEND}/api/open-app", json={"app": "whatsapp"}, timeout=5)
        except Exception:
            os.startfile("whatsapp://")
        return "Opening WhatsApp Desktop, sir."

    # ── Open App ──
    m = re.match(r'open\s+(.+)', q)
    if m:
        app_name = m.group(1).strip()
        web_map = {
            'youtube': 'https://www.youtube.com',
            'google': 'https://www.google.com',
            'github': 'https://github.com',
            'gmail': 'https://mail.google.com',
            'maps': 'https://maps.google.com',
            'instagram': 'https://www.instagram.com',
        }
        for k, url in web_map.items():
            if k in app_name:
                webbrowser.open(url)
                return f"Opening {k.capitalize()}, sir."
        try:
            r = requests.post(f"{BACKEND}/api/open-app", json={"app": app_name}, timeout=5)
            return r.json().get("message", f"Opening {app_name}, sir.")
        except Exception:
            return f"Backend offline. Cannot open {app_name}, sir."

    # ── Volume / System ──
    sys_map = {
        r'volume\s*up|louder|vol\s*up': 'volume-up',
        r'volume\s*down|quieter|lower\s*volume|vol\s*down': 'volume-down',
        r'\bmute\b|\bunmute\b': 'mute',
        r'brightness\s*up|brighter': 'brightness-up',
        r'brightness\s*down|dimm?er': 'brightness-down',
        r'lock\s*(computer|pc|screen)|lock\s*it': 'lock',
        r'shutdown|shut\s*down|turn\s*off': 'shutdown',
        r'restart|reboot': 'restart',
        r'screenshot|capture\s*screen': 'screenshot',
    }
    for pat, action in sys_map.items():
        if re.search(pat, q):
            try:
                r = requests.post(f"{BACKEND}/api/system", json={"action": action}, timeout=5)
                return r.json().get("message", "Done, sir.")
            except Exception:
                return "Backend offline. Start server.py first, sir."

    # ── Search ──
    m = re.match(r'search\s+(?:for\s+|google\s+)?(.+)', q)
    if m:
        webbrowser.open(f"https://www.google.com/search?q={urllib.parse.quote(m.group(1))}")
        return f"Searching Google for {m.group(1)}, sir."

    # ── Play music ──
    m = re.match(r'play\s+(.+)', q)
    if m:
        song = re.sub(r'\s+(on\s+)?(youtube|spotify|music|song)\s*$', '', m.group(1)).strip()
        webbrowser.open(f"https://www.youtube.com/results?search_query={urllib.parse.quote(song + ' song')}")
        return f"Playing {song} on YouTube, sir."

    # ── Add contact ──
    m = re.search(r'add\s+contact\s+([\w\s]+?)\s+(?:number|num|phone|at|is)\s+([\d\+\s\-]+)', raw, re.IGNORECASE)
    if m:
        name = m.group(1).strip()
        number = re.sub(r'\D', '', m.group(2))
        try:
            requests.post(f"{BACKEND}/api/contacts",
                          json={"name": name, "number": number},
                          timeout=5)
            load_contacts()
            return f"Contact {name} saved with number {number}, sir."
        except Exception:
            return "Could not save contact. Backend offline, sir."

    # ── Jokes ──
    if re.search(r'\bjoke\b|\bfunny\b|\blaugh\b', q):
        import random
        jokes = [
            "Why don't scientists trust atoms? Because they make up everything.",
            "Why do programmers prefer dark mode? Because light attracts bugs.",
            "I'm reading a book about anti-gravity. It's impossible to put down.",
            "Why do Java developers wear glasses? Because they don't C#.",
        ]
        return random.choice(jokes)

    # ── Identity ──
    if re.search(r'who are you|your name|what are you', q):
        return "I am J.A.R.V.I.S, Just A Rather Very Intelligent System. Your personal AI assistant, sir."

    if re.search(r'how are you|are you ok', q):
        return "All systems nominal. Operating at peak efficiency. How can I assist you, sir?"

    if re.search(r'goodbye|bye|sleep|exit', q):
        return "Goodbye, sir. I will be listening in the background if you need me."

    # ── Help ──
    if re.search(r'help|what can you do|commands', q):
        return ("Sir, I can: send WhatsApp messages, open apps, control volume and brightness, "
                "take screenshots, lock the PC, search Google, play music on YouTube, and more. "
                "Just say my name to wake me up.")

    # ── Weather ──
    m = re.search(r'weather\s+(?:in\s+|for\s+)?(.+)', q)
    if m:
        webbrowser.open(f"https://www.google.com/search?q=weather+{urllib.parse.quote(m.group(1))}")
        return f"Checking weather for {m.group(1)}, sir."
    if re.search(r'\bweather\b', q):
        webbrowser.open("https://www.google.com/search?q=weather")
        return "Checking weather for you, sir."

    # ── No match — forward to Gemini via backend ──
    try:
        r = requests.post(f"{BACKEND}/api/gemini", json={"prompt": raw}, timeout=15)
        if r.ok:
            return r.json().get("response", "")
    except Exception:
        pass

    return None  # Let caller decide what to do

# ─── Speech Recognition ──────────────────────────────────────────────
def listen_for_wake_word(recognizer: sr.Recognizer, source: sr.AudioSource) -> bool:
    """Listen for the wake word. Returns True if detected."""
    try:
        audio = recognizer.listen(source, timeout=5, phrase_time_limit=4)
        text = recognizer.recognize_google(audio, language="en-IN").lower()
        print(f"   Heard: {text}")
        return any(w in text for w in WAKE_WORDS)
    except sr.WaitTimeoutError:
        return False
    except sr.UnknownValueError:
        return False
    except sr.RequestError as e:
        print(f"   STT error: {e}")
        return False

def listen_for_command(recognizer: sr.Recognizer, source: sr.AudioSource) -> str | None:
    """Listen for a command after wake word. Returns transcript or None."""
    try:
        print("   🎙️  Listening for command...")
        audio = recognizer.listen(source, timeout=8, phrase_time_limit=10)
        text = recognizer.recognize_google(audio, language="en-IN")
        print(f"   You said: {text}")
        return text.strip()
    except sr.WaitTimeoutError:
        return None
    except sr.UnknownValueError:
        return None
    except sr.RequestError as e:
        print(f"   STT error: {e}")
        return None

# ─── Main Loop ───────────────────────────────────────────────────────
def main():
    print("=" * 56)
    print("  J.A.R.V.I.S — Background Listener Active")
    print("  Say 'Jarvis' or 'Hey Jarvis' to wake me up")
    print("  Backend  : " + BACKEND)
    print("  Press Ctrl+C to stop")
    print("=" * 56)

    # Wait for backend
    print("\n⏳ Connecting to backend server...")
    for _ in range(10):
        try:
            requests.get(f"{BACKEND}/api/contacts", timeout=2)
            print("✅ Backend connected!")
            break
        except Exception:
            time.sleep(1)
    else:
        print("⚠️  Backend not reachable — system commands won't work. Still proceeding...")

    load_contacts()
    print(f"📋 Loaded {len(_contacts)} contacts: {list(_contacts.keys())}\n")
    speak("J.A.R.V.I.S background listener active. Say Jarvis to wake me up, sir.")

    recognizer = sr.Recognizer()
    recognizer.energy_threshold = 300
    recognizer.dynamic_energy_threshold = True
    recognizer.pause_threshold = 0.8

    mic = sr.Microphone()

    with mic as source:
        print("🔇 Calibrating for ambient noise (1 sec)...")
        recognizer.adjust_for_ambient_noise(source, duration=1)
        print("✅ Ready! Sleeping — waiting for wake word...\n")

    while True:
        try:
            with mic as source:
                print("💤 SLEEPING — waiting for 'Jarvis'...", end='\r')
                woken = listen_for_wake_word(recognizer, source)

                if not woken:
                    continue

                # Wake word detected
                print("\n⚡ AWAKE — Listening for your command...")
                speak("Yes sir?")

                with mic as source:
                    command = listen_for_command(recognizer, source)

                if not command:
                    speak("I didn't catch that, sir. Please try again.")
                    continue

                print(f"\n📝 Command: {command}")
                setattr(main, '_last_cmd', command)

                response = process_command(command)

                if response:
                    speak(response)
                else:
                    speak("I'm not sure how to handle that, sir. Try opening your browser Jarvis tab for AI questions.")

        except KeyboardInterrupt:
            print("\n\n👋 Shutting down J.A.R.V.I.S background listener. Goodbye, sir.")
            speak("Goodbye sir. J.A.R.V.I.S going offline.")
            sys.exit(0)
        except Exception as e:
            print(f"\n⚠️  Error in listener loop: {e}")
            time.sleep(1)

if __name__ == "__main__":
    main()
