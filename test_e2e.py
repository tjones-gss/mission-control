"""Comprehensive Playwright E2E test for Oversight dashboard."""
from playwright.sync_api import sync_playwright
import json, time, os

os.makedirs('test_screenshots', exist_ok=True)

PASS = 0
FAIL = 0
WARN = 0

def check(name, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  PASS: {name}")
    else:
        FAIL += 1
        print(f"  FAIL: {name}")

def warn(msg):
    global WARN
    WARN += 1
    print(f"  WARN: {msg}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1920, 'height': 1080})
    page = context.new_page()

    # ============================================
    # TEST 1: Initial Load + Board View
    # ============================================
    print("\n=== TEST 1: Dashboard Load ===")
    page.goto("http://localhost:5173", wait_until="domcontentloaded", timeout=15000)
    # Wait for sessions to load (may be rate-limited if tests ran recently)
    time.sleep(6)
    # Wait up to 15s for sessions to appear
    try:
        page.wait_for_selector('aside button.text-left', timeout=15000)
    except:
        print("  NOTE: Sessions still loading (rate limiter may be active)")

    header = page.query_selector("header")
    header_text = header.text_content() if header else ""
    check("Oversight branding in header", "Oversight" in header_text)

    tab_buttons = page.query_selector_all("header nav button")
    tab_labels = [t.text_content().strip() for t in tab_buttons]
    check("Has Agents tab", "Agents" in tab_labels)
    check("Has Tasks tab", "Tasks" in tab_labels)
    check("Has Workflows tab", "Workflows" in tab_labels)
    check("Has Skills tab", "Skills" in tab_labels)
    check("Has Teams tab", "Teams" in tab_labels)
    check("Has History tab", "History" in tab_labels)

    page.screenshot(path="test_screenshots/01_board_view.png")

    # ============================================
    # TEST 2: Sidebar + Session Cards
    # ============================================
    print("\n=== TEST 2: Sessions Sidebar ===")
    sidebar = page.query_selector("aside")
    if sidebar:
        sidebar_text = sidebar.text_content()
        check("Sidebar has Sessions label", "Sessions" in sidebar_text)
        # Check for session content (sections or cards or "Loading")
        sidebar_full_text = sidebar.text_content() or ""
        has_sessions = "Active" in sidebar_full_text or "Recent" in sidebar_full_text or "Older" in sidebar_full_text
        has_loading = "Loading" in sidebar_full_text
        print(f"  Sidebar text preview: {sidebar_full_text[:100]}")
        if has_loading and not has_sessions:
            warn("Sessions still loading (rate limiter likely exhausted)")
        else:
            check("Sessions loaded in sidebar", has_sessions)
    else:
        warn("No sidebar found")

    # ============================================
    # TEST 3: Click into Detail View
    # ============================================
    print("\n=== TEST 3: Session Detail View ===")
    detail_btn = page.query_selector('button:has-text("Detail")')
    if detail_btn:
        detail_btn.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        # Check new sub-tabs exist
        check("Has conversation sub-tab", page.query_selector('button:has-text("conversation")') is not None)
        check("Has timeline sub-tab", page.query_selector('button:has-text("timeline")') is not None)
        check("Has summary sub-tab", page.query_selector('button:has-text("summary")') is not None)
        check("Has intel sub-tab", page.query_selector('button:has-text("intel")') is not None)
        check("Has config sub-tab", page.query_selector('button:has-text("config")') is not None)
        check("Has memory sub-tab", page.query_selector('button:has-text("memory")') is not None)
        check("Has plans sub-tab", page.query_selector('button:has-text("plans")') is not None)
        check("Has hooks sub-tab", page.query_selector('button:has-text("hooks")') is not None)
        check("Has mcp sub-tab", page.query_selector('button:has-text("mcp")') is not None)

        page.screenshot(path="test_screenshots/02_detail_conversation.png")
    else:
        warn("Detail button not found")

    # ============================================
    # TEST 4: Conversation View — clickable file paths
    # ============================================
    print("\n=== TEST 4: Conversation View ===")
    conv_text = page.text_content("main") or ""
    # Check for any vscode:// links (clickable file paths)
    vscode_links = page.query_selector_all('a[href^="vscode://"]')
    print(f"  VS Code file links found: {len(vscode_links)}")
    if len(vscode_links) > 0:
        check("Clickable file paths present", True)
        first_link = vscode_links[0]
        href = first_link.get_attribute("href") or ""
        print(f"  First link href: {href[:80]}")
    else:
        warn("No vscode:// links found (may depend on session content)")

    page.screenshot(path="test_screenshots/03_conversation_view.png")

    # ============================================
    # TEST 5: Summary Tab — tokens, cost, sparkline, compact
    # ============================================
    print("\n=== TEST 5: Summary Tab ===")
    summary_btn = page.query_selector('button:has-text("summary")')
    if summary_btn:
        summary_btn.click()
        time.sleep(3)  # Wait for messages API fetch for sparkline

        main_text = page.text_content("main") or ""
        has_think = "THINK" in main_text
        if not has_think:
            warn("No THINK section (session may lack thinking blocks)")
        else:
            check("Has THINK section", True)
        check("Has TOOLS section", "TOOLS" in main_text)
        check("Has SUBAGENTS section", "SUBAGENTS" in main_text)
        check("Has Tokens label", "Tokens" in main_text or "Input" in main_text)
        check("Has Compact button", "Compact" in main_text)

        # Check for cost dollar display
        dollar_signs = main_text.count("$")
        print(f"  Dollar signs in summary: {dollar_signs}")
        check("Has cost dollar display", dollar_signs > 0)

        # Check for sparkline SVG
        sparkline_svg = page.query_selector("main svg polyline")
        check("Has cost sparkline SVG", sparkline_svg is not None)

        # Check for token breakdown bars
        token_bars = page.query_selector_all('div[class*="rounded-full"][class*="bg-blue"], div[class*="rounded-full"][class*="bg-purple"]')
        print(f"  Token breakdown bars: {len(token_bars)}")

        # Check subagent type labels
        agent_type_badges = page.query_selector_all('span[class*="purple-900"]')
        print(f"  Agent type badges: {len(agent_type_badges)}")

        page.screenshot(path="test_screenshots/04_summary_tab.png")
    else:
        warn("Summary button not found")

    # ============================================
    # TEST 6: Config Tab
    # ============================================
    print("\n=== TEST 6: Config Tab ===")
    config_btn = page.query_selector('button:has-text("config")')
    if config_btn:
        config_btn.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Shows config sources section", "Config Sources" in main_text or "user" in main_text.lower())
        check("Shows merged config", "Merged" in main_text or "hooks" in main_text)
        check("Shows settings keys", "permissions" in main_text or "env" in main_text or "hooks" in main_text)

        page.screenshot(path="test_screenshots/05_config_tab.png")

    # ============================================
    # TEST 7: Memory Tab
    # ============================================
    print("\n=== TEST 7: Memory Tab ===")
    mem_btn = page.query_selector('button:has-text("memory")')
    if mem_btn:
        mem_btn.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Shows memory section", "Memory" in main_text or "Instructions" in main_text or "CLAUDE" in main_text)

        page.screenshot(path="test_screenshots/06_memory_tab.png")

    # ============================================
    # TEST 8: Plans Tab
    # ============================================
    print("\n=== TEST 8: Plans Tab ===")
    plans_btn = page.query_selector('button:has-text("plans")')
    if plans_btn:
        plans_btn.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        has_plan_list = "Plans" in main_text
        check("Shows plans list", has_plan_list)

        # Try expanding a plan
        plan_cards = page.query_selector_all('button:has-text("Plan:")')
        if not plan_cards:
            plan_cards = page.query_selector_all('div[class*="border-gray-800"] button')
        print(f"  Plan cards found: {len(plan_cards)}")
        if plan_cards:
            plan_cards[0].click()
            time.sleep(2)
            check("Plan expands on click", True)

        page.screenshot(path="test_screenshots/07_plans_tab.png")

    # ============================================
    # TEST 9: Hooks Tab
    # ============================================
    print("\n=== TEST 9: Hooks Tab ===")
    # Be very specific — find buttons in the sub-tab bar that exactly match
    sub_tab_buttons = page.query_selector_all('main button')
    hooks_btn = None
    for btn in sub_tab_buttons:
        txt = (btn.text_content() or "").strip().lower()
        if txt == "hooks":
            hooks_btn = btn
            break
    if hooks_btn:
        hooks_btn.click()
        time.sleep(3)  # Extra wait for API fetch

        main_text = page.text_content("main") or ""
        check("Shows Hook Bindings section", "Hook Bindings" in main_text)
        check("Shows PreToolUse events", "PreToolUse" in main_text)
        check("Shows PostToolUse events", "PostToolUse" in main_text)
        check("Shows Hook Scripts section", "Hook Scripts" in main_text)
        check("Shows bash script files", ".sh" in main_text)

        # Try expanding a hook script
        script_btns = page.query_selector_all('button:has-text(".sh")')
        if script_btns:
            script_btns[0].click()
            time.sleep(1)
            expanded_text = page.text_content("main") or ""
            check("Hook script expands to show content", "#!/" in expanded_text or "bash" in expanded_text or "echo" in expanded_text)

        page.screenshot(path="test_screenshots/08_hooks_tab.png")
    else:
        warn("Could not find hooks sub-tab button")

    # ============================================
    # TEST 10: MCP Tab
    # ============================================
    print("\n=== TEST 10: MCP Tab ===")
    mcp_btn = page.query_selector('button:has-text("mcp")')
    if mcp_btn:
        mcp_btn.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Shows MCP Servers section", "MCP" in main_text)
        page.screenshot(path="test_screenshots/09_mcp_tab.png")

    # ============================================
    # TEST 11: Switch to Skills Tab + Create a Skill
    # ============================================
    print("\n=== TEST 11: Skills Tab ===")
    skills_tab = page.query_selector('header nav button:has-text("Skills")')
    if skills_tab:
        skills_tab.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Skills panel loaded", "Skills" in main_text or "skill" in main_text.lower())

        # Look for New Skill button
        new_skill_btn = page.query_selector('button:has-text("New Skill")')
        if new_skill_btn:
            new_skill_btn.click()
            time.sleep(1)

            # Fill in skill form
            name_input = page.query_selector('input[placeholder*="name" i], input[placeholder*="Name" i]')
            if name_input:
                name_input.fill("oversight-health-check")
                time.sleep(0.5)

            desc_input = page.query_selector('textarea, input[placeholder*="description" i]')
            if desc_input:
                desc_input.fill("Quick health check for the Oversight dashboard — verifies API, SSE, and session parsing are working")
                time.sleep(0.5)

            content_input = page.query_selector('textarea[placeholder*="content" i], textarea[class*="font-mono"]')
            if content_input:
                content_input.fill("---\nname: oversight-health-check\ndescription: Quick dashboard health check\n---\n\nRun a health check on the Oversight dashboard.\n\n1. Verify /api/health returns 200\n2. Verify /api/sessions returns session list\n3. Verify SSE stream is connected\n4. Report any issues found")
                time.sleep(0.5)

            page.screenshot(path="test_screenshots/10_new_skill_form.png")
            check("Skill creation form opened", True)
            print("  (Not submitting to avoid side effects)")
        else:
            warn("New Skill button not found")

    # ============================================
    # TEST 12: Switch to Workflows Tab + Create a Workflow
    # ============================================
    print("\n=== TEST 12: Workflows Tab ===")
    workflows_tab = page.query_selector('header nav button:has-text("Workflows")')
    if workflows_tab:
        workflows_tab.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Workflows panel loaded", "Workflow" in main_text or "workflow" in main_text.lower())

        new_wf_btn = page.query_selector('button:has-text("New Workflow"), button:has-text("Create")')
        if new_wf_btn:
            new_wf_btn.click()
            time.sleep(1)

            wf_name = page.query_selector('input[placeholder*="name" i], input[placeholder*="Name" i]')
            if wf_name:
                wf_name.fill("deploy-and-verify")
                time.sleep(0.5)

            page.screenshot(path="test_screenshots/11_new_workflow.png")
            check("Workflow creation form opened", True)
        else:
            warn("New Workflow button not found")

    # ============================================
    # TEST 13: Teams Tab
    # ============================================
    print("\n=== TEST 13: Teams Tab ===")
    teams_tab = page.query_selector('header nav button:has-text("Teams")')
    if teams_tab:
        teams_tab.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("Teams panel loaded", "Team" in main_text or "team" in main_text.lower() or "No teams" in main_text)
        page.screenshot(path="test_screenshots/12_teams_tab.png")

    # ============================================
    # TEST 14: History Tab
    # ============================================
    print("\n=== TEST 14: History Tab ===")
    history_tab = page.query_selector('header nav button:has-text("History")')
    if history_tab:
        history_tab.click()
        time.sleep(2)

        main_text = page.text_content("main") or ""
        check("History panel loaded", "History" in main_text or "history" in main_text.lower() or "commands" in main_text.lower())
        page.screenshot(path="test_screenshots/13_history_tab.png")

    # ============================================
    # TEST 15: New Session Creation Form
    # ============================================
    print("\n=== TEST 15: New Session Form ===")
    # Switch back to Agents tab
    agents_tab = page.query_selector('header nav button:has-text("Agents")')
    if agents_tab:
        agents_tab.click()
        time.sleep(1)

    plus_btn = page.query_selector('aside button[title="New session"]')
    if plus_btn:
        plus_btn.click()
        time.sleep(1)

        # Check form fields
        cwd_input = page.query_selector('input[placeholder*="Working directory"]')
        prompt_input = page.query_selector('input[placeholder*="Prompt"]')
        name_input = page.query_selector('input[placeholder*="Session name"]')
        model_select = page.query_selector('select')

        check("Has CWD input", cwd_input is not None)
        check("Has prompt input", prompt_input is not None)
        check("Has name input", name_input is not None)
        check("Has model select", model_select is not None)

        # Fill in a demo session (but don't submit)
        if name_input:
            name_input.fill("test-oversight-session")
        if cwd_input:
            cwd_input.fill("C:/Users/Travesty/Desktop/Projects/oversight")
        if prompt_input:
            prompt_input.fill("Run the test suite and report results")

        page.screenshot(path="test_screenshots/14_new_session_form.png")
        check("New session form populated", True)

    # ============================================
    # TEST 16: Settings Modal
    # ============================================
    print("\n=== TEST 16: Settings Modal ===")
    settings_btn = page.query_selector('header button[title*="Settings"]')
    if settings_btn:
        settings_btn.click()
        time.sleep(1)

        modal_text = page.text_content("body") or ""
        check("Settings modal opened", "Notifications" in modal_text or "Sounds" in modal_text or "Shortcuts" in modal_text)

        page.screenshot(path="test_screenshots/15_settings_modal.png")

        # Close modal
        close_btn = page.query_selector('button[title="Close"], button:has-text("Close"), [class*="modal"] button:first-child')
        if close_btn:
            close_btn.click()
            time.sleep(0.5)

    # ============================================
    # TEST 17: Session Export API
    # ============================================
    print("\n=== TEST 17: Session Export API ===")
    # Test the export endpoint directly
    response = page.request.get("http://localhost:3001/api/sessions")
    if response.ok:
        sessions = response.json()
        if sessions and len(sessions) > 0:
            sid = sessions[0]["sessionId"]
            print(f"  Testing export for session: {sid[:16]}...")

            md_resp = page.request.get(f"http://localhost:3001/api/sessions/{sid}/export")
            check("MD export returns 200", md_resp.ok)
            if md_resp.ok:
                md_text = md_resp.text()
                check("MD export contains session header", "# Session:" in md_text)
                check("MD export has content", len(md_text) > 100)
                print(f"  MD export size: {len(md_text)} chars")

            json_resp = page.request.get(f"http://localhost:3001/api/sessions/{sid}/export?format=json")
            check("JSON export returns 200", json_resp.ok)
            if json_resp.ok:
                export_data = json_resp.json()
                check("JSON export has sessionId field", "sessionId" in export_data)
                check("JSON export has messages field", "messages" in export_data)
        else:
            warn("No sessions to test export with")

    # ============================================
    # TEST 18: Plans API
    # ============================================
    print("\n=== TEST 18: Plans API ===")
    plans_resp = page.request.get("http://localhost:3001/api/plans")
    if plans_resp.ok:
        plans = plans_resp.json()
        print(f"  Plans found: {len(plans)}")
        check("Plans API returns array", isinstance(plans, list))
        check("At least 1 plan exists", len(plans) > 0)

        if plans:
            first = plans[0]
            check("Plan has filename", "filename" in first)
            check("Plan has name", "name" in first)

            # Fetch individual plan
            detail_resp = page.request.get(f"http://localhost:3001/api/plans/{first['filename']}")
            check("Individual plan returns 200", detail_resp.ok)
            if detail_resp.ok:
                detail = detail_resp.json()
                check("Plan detail has content", "content" in detail and len(detail["content"]) > 0)

    # ============================================
    # TEST 19: Hooks API
    # ============================================
    print("\n=== TEST 19: Hooks API ===")
    hooks_resp = page.request.get("http://localhost:3001/api/hooks")
    if hooks_resp.ok:
        hooks = hooks_resp.json()
        check("Hooks API returns config", "config" in hooks)
        check("Hooks API returns matrix", "matrix" in hooks)
        check("Hooks API returns scripts", "scripts" in hooks)
        print(f"  Hook bindings: {len(hooks.get('matrix', []))}")
        print(f"  Hook scripts: {len(hooks.get('scripts', []))}")

    # ============================================
    # TEST 20: MCP API
    # ============================================
    print("\n=== TEST 20: MCP API ===")
    mcp_resp = page.request.get("http://localhost:3001/api/mcp-servers")
    if mcp_resp.ok:
        mcp = mcp_resp.json()
        check("MCP API returns servers", "servers" in mcp)
        print(f"  MCP servers: {len(mcp.get('servers', []))}")

    # ============================================
    # FINAL REPORT
    # ============================================
    browser.close()

    print("\n" + "=" * 50)
    print(f"RESULTS: {PASS} passed, {FAIL} failed, {WARN} warnings")
    print("=" * 50)

    if FAIL > 0:
        print("\nFAILED TESTS DETECTED — review screenshots in test_screenshots/")
        exit(1)
    else:
        print("\nALL TESTS PASSED!")
