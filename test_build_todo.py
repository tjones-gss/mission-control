"""
REAL END-TO-END BUILD TEST
Sends 10+ real messages through the Oversight dashboard to build a todo app.
Uses an existing session's message endpoint (PTY resume).
"""
from playwright.sync_api import sync_playwright
import json, time, os

os.makedirs('test_screenshots', exist_ok=True)
BUILD_DIR = 'C:/Users/Travesty/Desktop/Projects/todo-app-test'
os.makedirs(BUILD_DIR, exist_ok=True)

INTERACTIONS = 0
BASE = "http://localhost:3001"

def get_sessions(page):
    resp = page.request.get(f"{BASE}/api/sessions", timeout=60000)
    return resp.json() if resp.ok else []

def get_messages(page, sid):
    resp = page.request.get(f"{BASE}/api/sessions/{sid}/messages", timeout=60000)
    if resp.ok:
        return resp.json().get("messages", [])
    return []

def get_session(page, sid):
    resp = page.request.get(f"{BASE}/api/sessions/{sid}", timeout=60000)
    return resp.json() if resp.ok else None

def wait_idle(page, sid, timeout=120):
    """Wait until agent finishes (needsInput or message count increases then stops)."""
    start = time.time()
    last_count = 0
    stable = 0
    while time.time() - start < timeout:
        s = get_session(page, sid)
        if s:
            count = s.get("messageCount", 0)
            if s.get("needsInput"):
                return True
            if count > last_count:
                last_count = count
                stable = 0
            else:
                stable += 1
                # If count hasn't changed for 3 polls (15s), agent is likely done
                if stable >= 3 and count > 2:
                    return True
        time.sleep(5)
    return False

def send(page, sid, message, timeout=120):
    """Send a message and wait for response."""
    global INTERACTIONS
    INTERACTIONS += 1
    short = message[:70] + ("..." if len(message) > 70 else "")
    print(f"\n  [{INTERACTIONS}] >> {short}")

    resp = page.request.post(
        f"{BASE}/api/sessions/{sid}/message",
        data=json.dumps({"message": message}),
        headers={"Content-Type": "application/json"},
        timeout=120000
    )

    if not resp.ok:
        code = resp.status
        print(f"  [{INTERACTIONS}] Send failed: HTTP {code}")
        if code == 409:
            print(f"  [{INTERACTIONS}] Session busy — waiting 30s...")
            time.sleep(30)
            resp = page.request.post(
                f"{BASE}/api/sessions/{sid}/message",
                data=json.dumps({"message": message}),
                headers={"Content-Type": "application/json"},
                timeout=120000
            )
            if not resp.ok:
                print(f"  [{INTERACTIONS}] Retry failed: HTTP {resp.status}")
                return False
        else:
            return False

    print(f"  [{INTERACTIONS}] Sent. Waiting up to {timeout}s...")
    ok = wait_idle(page, sid, timeout=timeout)

    # Show what the agent did
    msgs = get_messages(page, sid)
    for m in reversed(msgs):
        if m.get("type") == "assistant":
            blocks = m.get("blocks", [])
            texts = [b["text"][:120] for b in blocks if b.get("type") == "text" and b.get("text")]
            tools = [b["name"] for b in blocks if b.get("type") == "tool_use"]
            if texts:
                print(f"  [{INTERACTIONS}] << {texts[-1]}")
            if tools:
                print(f"  [{INTERACTIONS}] Tools: {', '.join(tools)}")
            break

    status = "DONE" if ok else "TIMEOUT"
    print(f"  [{INTERACTIONS}] {status}")
    return ok


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    ctx.set_default_timeout(120000)
    page = ctx.new_page()

    page.goto("http://localhost:5174", wait_until="domcontentloaded", timeout=15000)
    time.sleep(5)

    print("=" * 70)
    print("  BUILDING A TODO APP VIA OVERSIGHT DASHBOARD")
    print("=" * 70)

    # Find the session to use (pick the most recent active one, or first one)
    sessions = get_sessions(page)
    active = [s for s in sessions if s.get("isActive")]
    sid = active[0]["sessionId"] if active else sessions[0]["sessionId"]
    print(f"\n  Using session: {sid[:16]}...")
    print(f"  CWD: {sessions[0].get('cwd', '?')}")
    print(f"  Model: {sessions[0].get('model', '?')}")

    # ─── INTERACTION 1: Setup — tell the agent what we're building ───
    send(page, sid,
        f"I want you to build me a todo app. Create a single file at {BUILD_DIR}/index.html. "
        "It should be a self-contained HTML file with embedded CSS and JS. Features: "
        "add todos, delete todos, mark complete (strikethrough), dark/light theme toggle, "
        "localStorage persistence, filter (All/Active/Completed), items-left counter. "
        "Start by creating the file with all features.",
        timeout=120)

    page.screenshot(path="test_screenshots/build_01.png")

    # ─── INTERACTION 2: Check and approve ───
    send(page, sid,
        "Read the file you just created and tell me: how many lines is it, "
        "and does it have all 6 features (add, delete, complete, theme, storage, filter)?",
        timeout=90)

    page.screenshot(path="test_screenshots/build_02.png")

    # ─── INTERACTION 3: Polish the UI ───
    send(page, sid,
        f"Make the dark mode in {BUILD_DIR}/index.html look better — use a dark background "
        "#1a1a2e with light text, and add a sun/moon emoji toggle button. Also add "
        "smooth CSS transitions when toggling theme and completing todos.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_03.png")

    # ─── INTERACTION 4: Add clear completed ───
    send(page, sid,
        f"Add a 'Clear Completed' button to {BUILD_DIR}/index.html that removes all "
        "completed todos at once. Place it next to the filter buttons.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_04.png")

    # ─── INTERACTION 5: Keyboard support ───
    send(page, sid,
        f"In {BUILD_DIR}/index.html, make sure pressing Enter in the input field "
        "adds the todo. Also add a subtle placeholder text like 'What needs to be done?'",
        timeout=90)

    page.screenshot(path="test_screenshots/build_05.png")

    # ─── INTERACTION 6: Visual polish ───
    send(page, sid,
        f"Add visual polish to {BUILD_DIR}/index.html: a box-shadow on the main container, "
        "rounded corners on inputs and buttons, a nice gradient header, and hover effects "
        "on the todo items and buttons.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_06.png")

    # ─── INTERACTION 7: Double-click to edit ───
    send(page, sid,
        f"Add double-click-to-edit functionality to {BUILD_DIR}/index.html. When you "
        "double-click a todo, it becomes an editable input. Press Enter to save, Escape to cancel.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_07.png")

    # ─── INTERACTION 8: Drag and drop reorder ───
    send(page, sid,
        f"Add drag-and-drop reordering to {BUILD_DIR}/index.html using the native HTML5 "
        "drag and drop API (no libraries). Todos should be draggable and the order persisted to localStorage.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_08.png")

    # ─── INTERACTION 9: Create a README ───
    send(page, sid,
        f"Create {BUILD_DIR}/README.md describing this todo app. List all features, "
        "how to run it (just open index.html), and the tech stack (vanilla HTML/CSS/JS).",
        timeout=90)

    page.screenshot(path="test_screenshots/build_09.png")

    # ─── INTERACTION 10: Final review ───
    send(page, sid,
        f"Read {BUILD_DIR}/index.html one more time. Give me the final line count and "
        "confirm all these features work: add, delete, complete, theme toggle, localStorage, "
        "filter, clear completed, enter key, double-click edit, drag reorder. "
        "Also list all files in {BUILD_DIR}.",
        timeout=90)

    page.screenshot(path="test_screenshots/build_10.png")

    # ─── INTERACTION 11 (bonus): Open it ───
    send(page, sid,
        f"Read the first 30 lines of {BUILD_DIR}/index.html and show me the HTML head section.",
        timeout=60)

    page.screenshot(path="test_screenshots/build_11.png")

    # ══════════════════════════════════════════════════════════════════
    # VERIFICATION: Check what was built on disk
    # ══════════════════════════════════════════════════════════════════
    print("\n" + "=" * 70)
    print("  VERIFICATION")
    print("=" * 70)

    index_path = os.path.join(BUILD_DIR, "index.html")
    readme_path = os.path.join(BUILD_DIR, "README.md")

    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()
        lines = html.count("\n") + 1
        print(f"\n  index.html: {len(html):,} bytes, {lines} lines")
        features = {
            "add todos": "addTodo" in html or "add-todo" in html or "appendChild" in html,
            "delete": "delete" in html.lower() or "remove" in html.lower(),
            "complete": "complete" in html.lower() or "strikethrough" in html or "line-through" in html,
            "dark mode": "dark" in html.lower() and ("toggle" in html.lower() or "theme" in html.lower()),
            "localStorage": "localStorage" in html,
            "filter": "filter" in html.lower() or "all" in html.lower(),
        }
        for feat, present in features.items():
            status = "YES" if present else "NO"
            print(f"  {feat}: {status}")
        all_present = all(features.values())
        print(f"\n  All core features present: {'YES' if all_present else 'NO'}")
    else:
        print(f"\n  index.html NOT FOUND at {index_path}")
        if os.path.exists(BUILD_DIR):
            print(f"  Files in dir: {os.listdir(BUILD_DIR)}")

    if os.path.exists(readme_path):
        print(f"  README.md: {os.path.getsize(readme_path)} bytes")
    else:
        print(f"  README.md not found")

    # ── Session stats ──
    print("\n  --- Session Stats ---")
    s = get_session(page, sid)
    if s:
        print(f"  Messages: {s.get('messageCount', '?')}")
        print(f"  Model: {s.get('model', '?')}")
        if s.get("estimatedCost"):
            print(f"  Cost: ${s['estimatedCost']['totalCost']:.2f}")
        if s.get("toolUseCounts"):
            print(f"  Tools: {dict(s['toolUseCounts'])}")

    # ── Take final screenshot ──
    page.goto("http://localhost:5174", wait_until="domcontentloaded", timeout=15000)
    time.sleep(3)
    page.click('button:has-text("Detail")')
    time.sleep(2)
    for btn in page.query_selector_all("main button"):
        if (btn.text_content() or "").strip().lower() == "summary":
            btn.click()
            time.sleep(3)
            break
    page.screenshot(path="test_screenshots/build_12_final.png")

    browser.close()

    print(f"\n{'=' * 70}")
    print(f"  COMPLETE — {INTERACTIONS} interactions with the agent")
    print(f"{'=' * 70}")
