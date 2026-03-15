"""
J.A.R.V.I.S — Python Backend Server
Gives Jarvis real Windows system control powers.
Run: python server.py
Then open: http://localhost:3000
"""

import os
import json
import subprocess
import webbrowser
import urllib.parse
import ctypes
import threading
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
try:
    import requests as _requests
except ImportError:
    _requests = None

# ─── App Setup ───────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
CONTACTS_FILE = BASE_DIR / "contacts.json"
STATIC_DIR = BASE_DIR  # serves index.html from the same folder

# Load .env from the parent directory where the user placed it
load_dotenv(BASE_DIR.parent / ".env")

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
CORS(app)  # Allow frontend to call backend from any port

# ─── Contacts Helpers ────────────────────────────────────────────
def load_contacts():
    if CONTACTS_FILE.exists():
        with open(CONTACTS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_contacts(contacts):
    with open(CONTACTS_FILE, "w", encoding="utf-8") as f:
        json.dump(contacts, f, indent=2, ensure_ascii=False)

# Ensure contacts file exists
if not CONTACTS_FILE.exists():
    save_contacts({})

# ─── App Name → Windows Command Map ──────────────────────────────
APP_MAP = {
    # System apps
    "notepad": "notepad.exe",
    "calculator": "calc.exe",
    "paint": "mspaint.exe",
    "calendar": "outlookcal:",
    "task manager": "taskmgr.exe",
    "file explorer": "explorer.exe",
    "control panel": "control.exe",
    "settings": "ms-settings:",
    "cmd": "cmd.exe",
    "command prompt": "cmd.exe",
    "powershell": "powershell.exe",
    "word": "winword.exe",
    "excel": "excel.exe",
    "powerpoint": "powerpnt.exe",
    
    # Browsers
    "chrome": "chrome.exe",
    "google chrome": "chrome.exe",
    "firefox": "firefox.exe",
    "edge": "msedge.exe",
    "microsoft edge": "msedge.exe",
    "brave": "brave.exe",
    "opera": "opera.exe",

    # Media
    "vlc": "vlc.exe",
    "spotify": "spotify.exe",
    "windows media player": "wmplayer.exe",

    # Communication
    "whatsapp": "WhatsApp.exe",
    "discord": "Discord.exe",
    "telegram": "Telegram.exe",
    "zoom": "Zoom.exe",
    "teams": "Teams.exe",
    "microsoft teams": "Teams.exe",
    "skype": "Skype.exe",

    # Games / Other
    "steam": "steam.exe",
    "vs code": "code.exe",
    "vscode": "code.exe",
    "visual studio code": "code.exe",
    "git bash": "git-bash.exe",
    "snipping tool": "SnippingTool.exe",
    "snip": "SnippingTool.exe",
}

def run_powershell(cmd):
    """Run a PowerShell command silently."""
    subprocess.Popen(
        ["powershell", "-WindowStyle", "Hidden", "-Command", cmd],
        creationflags=subprocess.CREATE_NO_WINDOW
    )

def open_app_by_name(name: str) -> tuple[bool, str]:
    """Try to open an app. Returns (success, message)."""
    name_lower = name.lower().strip()

    # Direct map lookup
    exe = APP_MAP.get(name_lower)
    if exe:
        try:
            if exe.endswith(":"):  # Protocol handler (ms-settings: etc.)
                os.startfile(exe)
            else:
                subprocess.Popen(exe, shell=True)
            return True, f"Opening {name}, sir."
        except Exception as e:
            pass  # Fall through to PowerShell

    # Try PowerShell Start-Process
    try:
        run_powershell(f"Start-Process '{name_lower}'")
        return True, f"Attempting to open {name}, sir."
    except Exception as e:
        return False, f"Could not open {name}: {str(e)}"

# ─── Routes ──────────────────────────────────────────────────────

# Serve the frontend
@app.route("/")
def index():
    return send_from_directory(str(BASE_DIR), "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(str(BASE_DIR), filename)

# ── Config ────────────────────────────────────────────────────────
@app.route("/api/config", methods=["GET"])
def api_config():
    return jsonify({"apiKey": os.environ.get("API_KEY", "")})

# ── Open App ──────────────────────────────────────────────────────
@app.route("/api/open-app", methods=["POST"])
def api_open_app():
    data = request.get_json(silent=True) or {}
    app_name = data.get("app", "").strip()
    if not app_name:
        return jsonify({"success": False, "message": "No app name provided."}), 400

    success, msg = open_app_by_name(app_name)
    return jsonify({"success": success, "message": msg})


# ── WhatsApp ──────────────────────────────────────────────────────
def _pywhatkit_send(number: str, message: str):
    """Send WhatsApp message fully automatically using Desktop App."""
    try:
        import pyautogui
        import time
        phone = f"+{number}" if not number.startswith("+") else number
        
        # 1. Open WhatsApp Desktop App directly to the chat
        wa_url = f"whatsapp://send?phone={phone}"
        os.startfile(wa_url)
        
        # 2. Wait for the app to open and focus natively
        time.sleep(6)
        
        # 3. Type the message step-by-step visually
        pyautogui.write(message, interval=0.04)
        time.sleep(1) # slight pause before sending
        
        # 4. Press Enter to send
        pyautogui.press('enter')
        
        return True, "Message sent successfully, sir."
    except Exception as e:
        return False, str(e)

@app.route("/api/whatsapp", methods=["POST"])
def api_whatsapp():
    data = request.get_json(silent=True) or {}
    number = data.get("number", "").strip().replace("+", "").replace("-", "").replace(" ", "")
    message = data.get("message", "").strip()
    auto_send = data.get("autoSend", False)  # If True, use pywhatkit to auto-send

    if not number:
        return jsonify({"success": False, "message": "Phone number required."}), 400

    encoded_msg = urllib.parse.quote(message) if message else ""

    # AUTO-SEND mode: use pywhatkit to fully send without user pressing anything
    if auto_send and message:
        try:
            ok, msg = _pywhatkit_send(number, message)
            if ok:
                return jsonify({"success": True, "message": "Message sent via WhatsApp, sir."})
        except Exception:
            pass  # fall through to desktop app

    # Try WhatsApp Desktop app first (Windows protocol handler)
    try:
        wa_url = f"whatsapp://send?phone={number}"
        if encoded_msg:
            wa_url += f"&text={encoded_msg}"
        os.startfile(wa_url)
        action = "Message ready to send" if message else "Opening chat"
        return jsonify({"success": True, "message": f"{action} via WhatsApp Desktop, sir."})
    except Exception:
        pass

    # Fallback: open wa.me in the default browser
    url = f"https://wa.me/{number}"
    if encoded_msg:
        url += f"?text={encoded_msg}"
    webbrowser.open(url)
    return jsonify({"success": True, "message": f"Opening WhatsApp Web, sir."})


# ── WhatsApp Background Auto-Send ──────────────────────────────────
@app.route("/api/whatsapp-send", methods=["POST"])
def api_whatsapp_send():
    """Fully auto-send a WhatsApp message using pywhatkit (background)."""
    data = request.get_json(silent=True) or {}
    number = data.get("number", "").strip().replace("+", "").replace("-", "").replace(" ", "")
    message = data.get("message", "").strip()

    if not number or not message:
        return jsonify({"success": False, "message": "Number and message required."}), 400

    def _bg_send():
        _pywhatkit_send(number, message)

    threading.Thread(target=_bg_send, daemon=True).start()
    return jsonify({"success": True, "message": "Sending message in background, sir."})



# ── Contacts ──────────────────────────────────────────────────────
@app.route("/api/contacts", methods=["GET"])
def get_contacts():
    return jsonify(load_contacts())

@app.route("/api/contacts", methods=["POST"])
def save_contact():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    number = data.get("number", "").strip().replace("+", "").replace(" ", "").replace("-", "")
    if not name or not number:
        return jsonify({"success": False, "message": "Name and number required."}), 400
    contacts = load_contacts()
    contacts[name.lower()] = number
    save_contacts(contacts)
    return jsonify({"success": True, "message": f"Contact '{name}' saved with number {number}."})

@app.route("/api/contacts/<name>", methods=["DELETE"])
def delete_contact(name):
    contacts = load_contacts()
    key = name.lower()
    if key in contacts:
        del contacts[key]
        save_contacts(contacts)
        return jsonify({"success": True, "message": f"Contact '{name}' deleted."})
    return jsonify({"success": False, "message": f"Contact '{name}' not found."}), 404


# ── System Commands ───────────────────────────────────────────────
@app.route("/api/system", methods=["POST"])
def api_system():
    data = request.get_json(silent=True) or {}
    action = data.get("action", "").lower().strip()

    try:
        if action == "shutdown":
            subprocess.run(["shutdown", "/s", "/t", "10"], shell=True)
            return jsonify({"success": True, "message": "Shutting down in 10 seconds, sir."})

        elif action == "cancel-shutdown":
            subprocess.run(["shutdown", "/a"], shell=True)
            return jsonify({"success": True, "message": "Shutdown cancelled, sir."})

        elif action == "restart":
            subprocess.run(["shutdown", "/r", "/t", "10"], shell=True)
            return jsonify({"success": True, "message": "Restarting in 10 seconds, sir."})

        elif action == "lock":
            ctypes.windll.user32.LockWorkStation()
            return jsonify({"success": True, "message": "Workstation locked, sir."})

        elif action == "sleep":
            run_powershell("Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)")
            return jsonify({"success": True, "message": "Going to sleep, sir."})

        elif action == "volume-up":
            run_powershell("""
                $obj = New-Object -ComObject WScript.Shell
                $obj.SendKeys([char]175)
                $obj.SendKeys([char]175)
                $obj.SendKeys([char]175)
                $obj.SendKeys([char]175)
                $obj.SendKeys([char]175)
            """)
            return jsonify({"success": True, "message": "Volume increased, sir."})

        elif action == "volume-down":
            run_powershell("""
                $obj = New-Object -ComObject WScript.Shell
                $obj.SendKeys([char]174)
                $obj.SendKeys([char]174)
                $obj.SendKeys([char]174)
                $obj.SendKeys([char]174)
                $obj.SendKeys([char]174)
            """)
            return jsonify({"success": True, "message": "Volume decreased, sir."})

        elif action == "mute":
            run_powershell("""
                $obj = New-Object -ComObject WScript.Shell
                $obj.SendKeys([char]173)
            """)
            return jsonify({"success": True, "message": "Audio toggled, sir."})

        elif action == "screenshot":
            import datetime
            screenshots_dir = Path.home() / "Pictures" / "Jarvis Screenshots"
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            path = screenshots_dir / f"jarvis_{timestamp}.png"
            run_powershell(f"""
                Add-Type -AssemblyName System.Windows.Forms
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen
                $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                $g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
                $bmp.Save('{str(path).replace(chr(92), '/')}')
            """)
            return jsonify({"success": True, "message": f"Screenshot saved to Pictures/Jarvis Screenshots, sir."})

        elif action == "brightness-up":
            run_powershell("""
                (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,[Math]::Min(100, (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness + 20))
            """)
            return jsonify({"success": True, "message": "Brightness increased, sir."})

        elif action == "brightness-down":
            run_powershell("""
                (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,[Math]::Max(0, (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness - 20))
            """)
            return jsonify({"success": True, "message": "Brightness decreased, sir."})

        else:
            return jsonify({"success": False, "message": f"Unknown action: {action}"}), 400

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# ── Gemini AI Proxy ────────────────────────────────────────────────
@app.route("/api/gemini", methods=["POST"])
def api_gemini():
    """Proxy for background_jarvis.py to use Gemini AI."""
    if _requests is None:
        return jsonify({"success": False, "response": "requests not installed."}), 500

    data = request.get_json(silent=True) or {}
    prompt = data.get("prompt", "").strip()
    api_key = os.environ.get("API_KEY", "")

    if not prompt:
        return jsonify({"success": False, "response": "No prompt provided."}), 400
    if not api_key:
        return jsonify({"success": False, "response": "No API key configured."}), 400

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        body = {
            "system_instruction": {"parts": [{"text": (
                "You are J.A.R.V.I.S (Just A Rather Very Intelligent System), Tony Stark's AI. "
                "Respond as JARVIS: professional, precise, slightly formal, occasionally witty. "
                "Keep responses under 3 sentences. Always address the user as 'sir'. Never break character."
            )}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.8, "maxOutputTokens": 300}
        }
        res = _requests.post(url, json=body, timeout=15)
        res.raise_for_status()
        text = res.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        return jsonify({"success": True, "response": text})
    except Exception as e:
        return jsonify({"success": False, "response": f"Gemini error: {str(e)}"}), 500


# ─── Start Server ─────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 55)
    print("  J.A.R.V.I.S Backend — Python Edition")
    print("  Running on: http://localhost:3000")
    print("  Open your browser to: http://localhost:3000")
    print("  Background listener: python background_jarvis.py")
    print("=" * 55)
    app.run(host="0.0.0.0", port=3000, debug=False)
