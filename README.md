# 🧠 PromptIQ — Project Summary & Complete Workflow Guide

> **Your Universal AI Co-Pilot & Seamless Session Migration Assistant**  
> *Transform rough thoughts into expert-level prompts, and move your conversations across any AI platform with zero lost context.*

---

## 📖 1. What is PromptIQ? (The Big Picture)

When working with modern AI assistants like **ChatGPT**, **Claude**, **Gemini**, **Perplexity**, or **Copilot**, users constantly run into two massive roadblocks:

1. **The "Blank Box" Problem (Garbage in, Garbage out):**  
   Typing a quick, informal thought like *"make me a login page"* usually results in a generic, incomplete answer. Great results require role definition, constraints, best practices, and formatting requirements — things people rarely have the time or energy to type out every time.
2. **The "Limit Reached" & Walled Garden Problem:**  
   You are 30 messages deep into designing a complex project or fixing a stubborn bug, and suddenly:
   - *"You've reached your free message limit. Resets in 4 hours."*
   - Or the conversation gets so long the AI becomes slow and forgets earlier instructions.
   - Or you want to take your work from Claude over to ChatGPT or Gemini to get a second opinion.  
   **Starting over in a new window is painful.** You have to manually re-explain your entire project, constraints, and progress from scratch.

### 🌟 How PromptIQ Solves Both:
- 🪄 **Instant Prompt Polish (The Intelligent Co-Pilot):** Automatically intercepts your draft, asks how you want it framed (Coding, Creative, Business, Quick Answer, or Deep Thinking), and turns your 5-word draft into an expert prompt right inside the input box — with a 1-click **Undo** button if you prefer your original wording.
- 📦 **Session Migration (The Digital Moving Truck):** One click packages your entire conversation — past goals, working code, decisions made, and exact chat pairs — into a lightweight **2-file ZIP**. You drop or paste it into a brand-new chat (on Claude, ChatGPT, or Gemini), and the new AI immediately continues where the old one stopped.

---

## 🗺️ 2. High-Level System Architecture

Here is how all the pieces work together in plain, non-technical terms:

```mermaid
flowchart TD
    subgraph Browser["💻 Inside Your Web Browser"]
        User["👤 You (User)"]
        ChatPage["🌐 Any AI Chat Site<br/>(ChatGPT, Claude, Gemini, Perplexity, Copilot)"]
        Extension["🧩 PromptIQ Browser Extension<br/>(Background Brain & Smart Interceptor)"]
    end

    subgraph Cloud["☁️ PromptIQ Cloud Edge (Cloudflare Worker)"]
        AIModel["🤖 Intelligent Brain (AI Engine)<br/>Groq / Llama-3 Fast Model"]
    end

    User -->|"Types draft or clicks buttons"| ChatPage
    ChatPage <-->|"Watches input box & messages"| Extension
    Extension <-->|"Sends text to enhance or summarize"| Cloud
    Cloud <-->|"Lightning-fast prompt enhancement & handoff briefs"| AIModel
    Extension -->|"Delivers polished prompt or Migration ZIP"| User
```

### The 3 Core Moving Parts:
1. **The Browser Extension:** Lives quietly in your browser. It knows the exact layout of ChatGPT, Claude, Gemini, Perplexity, and Copilot.
2. **The Cloud Brain (Cloudflare Worker):** A lightning-fast server running on the global edge network. It takes your rough thoughts and drafts expert prompts in less than a second.
3. **The User Controls (Toolbar & Popup):** Simple menus that let you pick prompt categories, trigger Alt+E shortcuts, or hit "Migrate Session (ZIP)".

---

## 🪄 3. Feature 1: Prompt Enhancement Workflow

How PromptIQ transforms your ideas before the AI sees them:

```mermaid
sequenceDiagram
    autonumber
    actor You as 👤 You
    participant Input as 📝 AI Chat Box (ChatGPT / Claude / etc.)
    participant Extension as 🧩 PromptIQ Extension
    participant Cloud as ☁️ AI Polish Engine

    You->>Input: Type a rough thought (e.g., "fastapi login with redis")
    You->>Input: Press Enter (or shortcut Alt + E)
    Extension->>Input: Intercepts send action smoothly
    Extension->>You: Displays Category & Style Picker right above your cursor
    You->>Extension: Choose Category (Coding, Business, etc.) & Style (Quick or Deep Think)
    Extension->>Cloud: Sends draft + category + tag + purpose + last 4 chat messages (context)
    Cloud->>Extension: Returns polished prompt with purpose integrated in final return
    Extension->>Input: Replaces rough draft with polished prompt
    Extension->>You: Shows "Prompt Enhanced" badge with [Undo] button
    Note over You,Input: Press Enter again to send, or click Undo to revert back!
```

### Step-by-Step Walkthrough:
1. **You type normally:** Write whatever is on your mind into the input box.
2. **Smooth Interception:** When you press Enter (or press `Alt + E`), PromptIQ pauses the message from sending immediately.
3. **Pick Your Goal:** A sleek, friendly chip appears above your input box offering:
   - 💻 **Coding:** Adds architecture, error-handling, clean code principles, and modern framework conventions.
   - ✍️ **Creative:** Enhances tone, imagery, and storytelling depth.
   - 💼 **Business:** Focuses on actionable strategy, executive clarity, and ROI.
   - ⚡ **Quick Mode:** Tells the AI to skip polite introductions and deliver the direct answer immediately.
   - 🧠 **Think Mode:** Tells the AI to ask you clarifying questions first before writing code.
4. **Instant Polish:** In under 1 second, your input box updates with the polished version.
5. **Always in Control:** Don't like the new prompt? Click **Undo** (or press Escape), and your exact original text is restored instantly.

---

## 📦 4. Feature 2: Session Migration Workflow (Moving Between AI Chats)

When an AI hits its message limit, or when a chat gets too long and laggy, Session Migration saves the day:

```mermaid
flowchart TD
    Start["⚠️ Problem: Claude or ChatGPT hits message limit<br/>OR chat gets too long and slow"] --> ClickMigrate["🖱️ You click PromptIQ Extension Icon<br/>→ Click '📦 Migrate Session (ZIP)'"]
    
    subgraph Extraction["🔍 Step 1: Intelligent Scraping"]
        Scan["1. Reads Chat History"]
        FindGoal["2. Discovers Main Project Goal"]
        GetCode["3. Finds Latest Working Code & Edits"]
        GetPairs["4. Captures Key Conversation Exchanges<br/>(First 4 Project Setup + Last 4 Recent Work)"]
        Scan --> FindGoal --> GetCode --> GetPairs
    end

    ClickMigrate --> Extraction

    subgraph Packaging["⚙️ Step 2: Handoff Creation"]
        AISummary["🤖 AI Brain drafts seamless 7-Part Handoff Brief<br/>(Goal, Background, Decisions, State, Next Steps, Constraints)"]
        MakeJson["📋 Formats Structured JSON Checkpoint<br/>(Messages with Prompt, Response, Timestamps)"]
        MakeZip["🗂️ JSZip creates lightweight 2-file download"]
        AISummary --> MakeZip
        MakeJson --> MakeZip
    end

    Extraction --> Packaging

    subgraph Done["🚀 Step 3: Seamless Continuation"]
        Download["📥 Browser downloads 'promptiq_migration_...zip'"]
        NewChat["🆕 Open a fresh chat in Claude, ChatGPT, or Gemini"]
        Paste["📋 Copy & paste 'session_summary.md' into the new chat"]
        Continue["✨ New AI says: 'I have full context! Let us continue with next steps...'"]
        Download --> NewChat --> Paste --> Continue
    end

    Packaging --> Done
```

---

## 📂 5. What is Inside the Migration ZIP?

The migration ZIP is intentionally kept clean, fast, and clutter-free — containing strictly **two essential files**:

| File Name | Purpose | What It Contains | How to Use It |
| :--- | :--- | :--- | :--- |
| **`session_summary.md`** | **The Executive Handoff Brief** | A clean, human-readable summary written specifically for a new AI to read. It tells the new AI: <br/>1. What the overall project goal is.<br/>2. Key facts and background.<br/>3. Architectural decisions already agreed upon.<br/>4. The current state and working code.<br/>5. Exactly what task is pending next.<br/>6. Things to avoid. | **Simply copy the text and paste it into your new chat window.** The new AI immediately knows everything. |
| **`session_continuation.json`** | **The Structured Technical Checkpoint** | A clean JSON record containing the first 4 setup exchanges and the last 4 recent exchanges, complete with prompts, AI responses, and timestamps. | For backups, programmatic reload, or automated toolchains. |

---

## ⚡ 6. Smart Edge Cases: How PromptIQ Handles Real-World Chat Quirks

PromptIQ was engineered to adapt to messy, real-world web environments:

```mermaid
flowchart LR
    subgraph Situations["Everyday Situations"]
        A["1. Chat at Idle<br/>(Nothing typed in input box)"]
        B["2. AI Chat Discusses 'Rate Limits'<br/>(Casual chat about APIs)"]
        C["3. Real Limit Banner Appears<br/>('Out of free messages')"]
        D["4. Screen Reader Elements<br/>('You said:' / 'ChatGPT said:')"]
    end

    subgraph Handling["PromptIQ Smart Behavior"]
        A -->|"Extracts all screen messages cleanly<br/>without demanding a draft"| H1["✅ Full Migration Downloads Immediately"]
        B -->|"Checks ONLY real alert banners<br/>ignores casual discussion in chat"| H2["✅ No False-Alarm Warnings"]
        C -->|"Flags response as cut-off<br/>instructs new AI to finish it"| H3["⚠️ Flags 'Incomplete Response' for New Session"]
        D -->|"Silently strips hidden tags"| H4["✨ Pristine, Clean Text"]
    end
```

1. **At Idle (Nothing in Input Box):** You don't have to type anything in the chat box to migrate. PromptIQ automatically reads your chat history directly from the page.
2. **No False-Alarm Warnings:** If you and the AI are discussing *"how to build an API rate limiter"*, PromptIQ won't confuse that with a real ChatGPT usage block. It only flags cutoffs if an actual system alert banner is active.
3. **Screen-Reader Cleanups:** Hidden web tags like `"You said:"` or `"ChatGPT said:"` are automatically cleaned up so your exported files are crisp and readable.
4. **1-Click Safety:** Enhancement never traps you — pressing Enter again sends the enhanced prompt, while clicking **Undo** or pressing `Esc` brings your original words back immediately.

---

## 🌐 7. Supported Platforms Matrix

PromptIQ automatically identifies which site you are on and adapts its behavior instantly:

| Platform | Domain | Prompt Enhancement | Session Migration | Auto-Detects Limits |
| :---: | :---: | :---: | :---: | :---: |
| **OpenAI ChatGPT** | `chatgpt.com`, `chat.openai.com` | ✅ Yes | ✅ Yes (Full 2-File ZIP) | ✅ Yes |
| **Anthropic Claude** | `claude.ai` | ✅ Yes | ✅ Yes (Full 2-File ZIP) | ✅ Yes |
| **Google Gemini** | `gemini.google.com` | ✅ Yes | ✅ Yes (Full 2-File ZIP) | ✅ Yes |
| **Perplexity AI** | `perplexity.ai` | ✅ Yes | ✅ Yes (Full 2-File ZIP) | ✅ Yes |
| **Microsoft Copilot** | `copilot.microsoft.com` | ✅ Yes | ✅ Yes (Full 2-File ZIP) | ✅ Yes |

---

## 🎯 8. Summary in One Sentence

> **PromptIQ makes your AI prompts 10x better before you hit send, and lets you transport an entire conversation from any AI to any other AI in 5 seconds flat.**
