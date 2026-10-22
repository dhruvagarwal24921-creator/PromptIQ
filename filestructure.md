# 📁 PromptIQ — Complete Project File & Folder Structure Guide

> **Quick Summary**: This document explains every folder and file bundle in the PromptIQ codebase in simple, easy-to-understand terms. Use this as your map to navigate the repository.

---

# 🗺️ 1. High-Level Workspace Tree

```text
PromptIQ/
├── 🧩 extension/             👉 BUNDLE 1: The Chrome Browser Extension (Client-side)
│   ├── manifest.json         (The Extension Blueprint)
│   ├── background.js         (The Background Service Worker & Network Proxy)
│   ├── content/              (Scripts running directly inside web pages)
│   │   ├── content.js        (Event Interceptor & State Machine)
│   │   ├── editor.js         (Universal Rich-Text Typing Engine)
│   │   ├── ui.js             (Floating Category Pill & Undo Toolbar)
│   │   ├── chatDom.js        (DOM Scraper & Copilot Shadow Root Piercer)
│   │   ├── chatLog.js        (Prompt History & Latency Tracker)
│   │   ├── exporter.js       (Session Migration 2-File ZIP Creator)
│   │   └── adapters/         (Platform-specific selectors: ChatGPT, Claude, etc.)
│   └── popup/                (Extension Toolbar Popup Dashboard)
│
├── ⚙️ backend/               👉 BUNDLE 2: Canonical Local Node/Express Backend
│   ├── src/
│   │   ├── server.js         (Express Gateway, CORS, Helmet, Compression)
│   │   ├── config.js         (Fail-Fast Environment Validation)
│   │   ├── middleware/       (Sliding-Window IP Rate Limiter)
│   │   ├── routes/           (API Endpoints: /enhance and /summarize)
│   │   └── services/         (AI Metaprompts, Guardrails, Model Cascade)
│   ├── test/                 (Native Node.js Automated Unit Tests)
│   └── test-api.js           (Live Latency & Token Benchmarking Script)
│
├── ☁️ cloudflare-worker/     👉 BUNDLE 3: Production Serverless Edge Deployment
│   ├── src/index.js          (Complete Standalone Edge Backend in V8 Isolates)
│   ├── wrangler.toml         (Cloudflare Infrastructure Config & Secrets)
│   └── package.json          (Wrangler CLI dependencies)
│
├── 🧪 tests/                 👉 BUNDLE 4: Automated E2E & Offline Test Suite
│   ├── stub-backend.js       (Offline Mock Backend for Playwright Tests)
│   ├── e2e.js                (End-to-End Browser Automation Suite)
│   └── test-migration-zip.js (Automated 2-File ZIP Validator)
│
└── 📖 Root Documentation & Scripts
    ├── deploy-worker.bat     (1-Click Script to Deploy Cloudflare Worker)
    ├── imp.md                (CLI Deployment & Incognito Login Commands)
    ├── speech.md             (5-Minute Team Presentation & Demo Script)
    ├── member1workflow.md    (Frontend & DOM Workflows — Member 1)
    ├── member2workflows.md    (Core Backend & AI Workflows — Member 2)
    ├── member3workflows.md    (Cloudflare Edge Workflows — Member 3)
    └── report.md             (Formal Comprehensive Project Report)
```

---

# 📦 2. Bundle Breakdown — What Each Folder & File Does

---

## 🧩 BUNDLE 1: `extension/` (The Browser Extension)
> **Managed by**: **Member 1**  
> **In Plain English**: This is what installs into Google Chrome. It sits quietly in the browser, watches for when you press `Alt + E` on ChatGPT or Claude, pops up the category buttons, types the improved prompt into the input box, and packages your chat into a ZIP when you click "Migrate".

### Core Files inside `extension/`:
* **`manifest.json` (The Identity Card)**:
  Tells Chrome what permissions the extension needs (storage, activeTab), which AI websites it is allowed to run on (`chatgpt.com`, `claude.ai`, `copilot.microsoft.com`, etc.), and which scripts to run.
* **`background.js` (The Secret Agent)**:
  Runs silently behind the scenes. It acts as a bridge between the webpage and the cloud backend. When you enhance a prompt, it makes the HTTPS request to Cloudflare, saves your history to Chrome's local storage, and handles network security.
* **`popup/popup.html` & `popup.js` (The User Dashboard)**:
  The small menu that opens when you click the PromptIQ puzzle piece icon in Chrome's top toolbar. Lets you change your Backend URL (Localhost vs. Cloudflare), toggle auto-enhance, and see stats.

### The Brain inside `extension/content/` (Web Page Scripts):
* **`content.js` (The Traffic Police)**:
  Coordinates everything on the web page. Listens for the Enter key or `Alt + E`, pauses the message from sending, and manages the 4-state machine (`IDLE` $\rightarrow$ `INTERCEPTED` $\rightarrow$ `ENHANCING` $\rightarrow$ `ENHANCED`).
* **`editor.js` (The Robot Typer)**:
  Modern AI sites (like ChatGPT) do not use simple text boxes; they use complex React editors (ProseMirror, Quill). If you use normal JavaScript `element.value = ...`, the page breaks. `editor.js` sends synthetic `InputEvents` that simulate human typing without breaking the website.
* **`ui.js` (The Isolated Button Pill)**:
  Creates the floating toolbar with the Category pills (Coding, Learning, Write) and the **[Undo]** button. It uses an **isolated Shadow DOM** so the website's dark mode or CSS never breaks PromptIQ's buttons.
* **`chatDom.js` (The Chat Reader)**:
  Reads past chat messages from the webpage. For Microsoft Copilot, it uses special **recursive Shadow DOM piercing** to read through Copilot's nested web components.
* **`chatLog.js` (The Local Memory)**:
  Saves recent prompts in local memory and tracks how fast the AI answered.
* **`exporter.js` (The Moving Truck)**:
  Scrapes the whole conversation, grabs the first 4 turns (initial goal) + the last 32 turns (recent working code), calls the `/summarize` API, and zips everything into a clean **2-file ZIP** (`session_summary.md` and `session_continuation.json`) using JSZip.
* **`adapters/` (`chatgpt.js`, `claude.js`, `copilot.js`, etc.)**:
  Custom adapter files for each AI website so PromptIQ knows the exact HTML selectors for the chat box and send button on each platform.

---

## ⚙️ BUNDLE 2: `backend/` (The Core Node/Express Server)
> **Managed by**: **Member 2**  
> **In Plain English**: This is the canonical backend service built with Node.js and Express. It holds all the prompt engineering rules, the 5 quality guardrails, rate limiting, and automated unit tests. It is used for local development, automated testing, and as the reference model for Cloudflare.

### Core Files inside `backend/`:
* **`src/server.js` (The Front Door)**:
  Initializes the Express server on port 3000. Protects the server with security headers (`helmet`), data compression (`compression`), CORS origin checks, and handles graceful shutdown when pressing `Ctrl+C`.
* **`src/config.js` (The Gatekeeper)**:
  Validates that your API key, port, and settings are present in `.env`. If anything is missing, it refuses to start and tells you immediately.
* **`src/middleware/rateLimit.js` (The Spam Shield)**:
  Limits each IP address to prevent spam or runaway loops from draining your AI API credits.
* **`src/routes/enhance.js` (Prompt Enhance Route)**:
  Handles `POST /enhance`. Validates draft length (under 20,000 characters), trims past context down to the last 4 turns, and sends the prompt to the AI enhancer.
* **`src/routes/summarize.js` (Session Migration Route)**:
  Handles `POST /summarize`. Slices long chat histories (>36 messages $\rightarrow$ first 4 + last 32 turns), sanitizes code blocks, and detects if Claude was cut off mid-sentence.
* **`src/services/enhancer.js` (The AI Prompt Doctor)**:
  Contains the master 8-rule metaprompt. It injects invisible zero-width spaces (`\u200B`) to block prompt injection hacks, adds category instructions, and connects to the Dahl Inference API.
* **`src/services/summarizer.js` (The Handoff Writer)**:
  Generates the structured 8-section Markdown brief (`Goal`, `Instructions`, `Current State`, `Latest Code`, `Interruption Recovery`, `Next Steps`).
* **`src/services/validate.js` (The Quality Inspector)**:
  Contains the **5 Deterministic Guardrails**. If the AI modified even one comma of user-pasted code, leaked internal tags, or hallucinated thousands of words, it rejects the response with HTTP 422.
* **`test/validate.test.js` & `test/summarize.test.js` (Automated Tests)**:
  10 automated unit tests run via `npm test` (`node:test`) that verify guardrails and migration prompts in under 80 milliseconds.
* **`test-api.js` (Live Benchmark)**:
  A script you can run (`node test-api.js`) to measure live AI response speed and token usage across Coding, Learning, and Writing categories.

---

## ☁️ BUNDLE 3: `cloudflare-worker/` (The Serverless Edge Cloud)
> **Managed by**: **Member 3**  
> **In Plain English**: This is PromptIQ's production cloud brain. Instead of needing a local server running on your computer, this script is deployed globally across 300+ Cloudflare data centers. It runs 24/7, boots in 5 milliseconds, and costs zero dollars on the free tier.

### Core Files inside `cloudflare-worker/`:
* **`src/index.js` (The Entire Edge Backend in One File)**:
  A self-contained 679-line JavaScript script running inside Cloudflare V8 worker isolates. It handles CORS preflight (`OPTIONS`), `/health`, `/enhance`, `/summarize`, the 5 deterministic guardrails, and the 3-model fallback cascade.
* **`wrangler.toml` (Cloudflare Settings)**:
  The deployment config file that specifies your worker name (`promptiq-backend`), compatibility date, and environment secrets (`DAHL_API_KEY`, `DAHL_MODEL`).
* **`package.json`**:
  Contains developer dependencies to run the Wrangler CLI.

---

## 🧪 BUNDLE 4: `tests/` (The Automated QA Suite)
> **In Plain English**: These files let developers run automated browser tests (using Playwright) to guarantee that nothing breaks when code changes.

### Core Files inside `tests/`:
* **`stub-backend.js` (The Mock Server)**:
  A tiny local HTTP server that pretends to be the AI backend. It lets the test suite run 100% offline without needing internet or real API keys.
* **`e2e.js` & `e2e2.js` (End-to-End Tests)**:
  Playwright scripts that automatically open Chromium, type text into chat inputs, press `Alt + E`, and verify that the enhanced prompt appears.
* **`test-migration-zip.js` (ZIP File Verifier)**:
  Tests that clicking "Migrate Session" actually produces a valid 2-file `.zip` containing `session_summary.md` and `session_continuation.json`.
* **`test-copilot.js`**:
  Specifically tests piercing Microsoft Copilot's nested Shadow DOM web components.

---

## 🚀 BUNDLE 5: Root Scripts & Team Documentation

* **`deploy-worker.bat`**:
  A Windows batch script. Double-click this file to compile and deploy `cloudflare-worker/src/index.js` to Cloudflare globally in 3 seconds.
* **`imp.md`**:
  Cheat-sheet with the exact command lines to login and deploy to Cloudflare.
* **`speech.md`**:
  A 5-minute timed team presentation script with exact speaker dialogue, stage directions, and Q&A defense for Member 3, Member 2, and Member 1.
* **`member1workflow.md`**:
  Deep 650-line documentation of the Chrome extension, DOM manipulation, and Shadow DOM.
* **`member2workflows.md`**:
  Deep 700-line documentation of the Express backend, prompt engineering, and guardrails.
* **`member3workflows.md`**:
  Deep 680-line documentation of Cloudflare serverless edge, deployment, and DevOps.
* **`PROJECT_SUMMARY.md` & `report.md`**:
  Comprehensive project summaries, problem statements, and academic-grade reports.

---

# 📊 3. Responsibility & Ownership Matrix

| Folder / Bundle | Primary Owner | Technology Used | What It Solves |
| :--- | :--- | :--- | :--- |
| **`extension/`** | **Member 1** | Chrome MV3, JavaScript, Shadow DOM, InputEvents | Seamless UI, 5-site DOM adaptation, zero-risk Undo |
| **`backend/`** | **Member 2** | Node.js, Express, Regex Guardrails, Metaprompts | AI prompt polish, code preservation, test coverage |
| **`cloudflare-worker/`** | **Member 3** | Cloudflare Workers, V8 Isolates, Wrangler, Edge APIs | 24/7 global availability, 0 cold start, multi-model failover |
| **`tests/`** | **Team QA** | Playwright, Node:test, Offline Stubs | Automated regression testing, ZIP verification |
| **Root Scripts** | **DevOps** | Batch scripts, Markdown documentation | 1-click global deployment, presentation readiness |
