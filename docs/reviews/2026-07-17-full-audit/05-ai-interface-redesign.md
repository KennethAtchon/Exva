# AI Assistant Interface — Polish & Redesign Plan

Audit date: 2026-07-17. Audience: an executing AI agent. Every claim below was verified against the code at the cited file:line. Read the cited files before editing them.

### TLDR: shortcuts taken

- Findings are from code reading only — the app was **not** launched and screenshotted for this doc. Before/after screenshots are required during execution (rule: look at every visual change with your own eyes, `scripts/ui-snap.ts` exists for this).
- The backend control-agent loop (`electron/main/services/control/`) is covered in `03-ai-capability-parity.md`, not here; this doc assumes the event contract (`control_delta`, `control_tool_call`, …) stays as-is.
- "Professional polish" targets are inferred from best-in-class assistant UIs (Claude/ChatGPT/Cursor sidebars), not from a Ken-approved mock. Confirm the direction in Core Decisions before executing.

### User journey (target)

1. Ken presses the assistant shortcut or the rail button anywhere in the app. A panel slides in smoothly from the right (animated, focus lands in the composer).
2. If he opened it from a session screen, the conversation is already scoped to that session and the scope chip says so.
3. He types "why is my session waiting?" — the reply streams in as rendered markdown (tables, code, mermaid all render), tool calls appear as tidy, collapsible cards with live status.
4. A mutating action pauses on a confirmation card that clearly states what will change and the risk; Confirm/Reject are one click; a failed confirm resets cleanly with an error message.
5. He can browse past conversations in a list, rename them inline (no browser prompt), open a full-page view for long sessions of work, and copy any assistant message.
6. He closes the panel; reopening restores exactly where he left off.

### Core decisions (sign-off required)

1. **Adopt a real markdown renderer** (`react-markdown` + `remark-gfm` + existing `mermaid` dep) instead of growing the hand-rolled parser. Recommended: yes — the parser is the single biggest "looks amateur" factor. Alternative: extend `MarkdownContent.tsx` by hand (more code, permanently behind).
2. **Build the full-page assistant view** (new hub) vs slide-over only. Recommended: build it — the button already exists but is dead, and long trading conversations don't fit 420px.
3. **Rebuild slide-over on Radix Dialog** for focus trap/a11y/animation vs keep the hand-rolled fixed div. Recommended: Radix (already a dependency, used elsewhere).
4. **Token vocabulary**: control components currently mix shadcn tokens (`bg-primary`, `text-muted-foreground`) with the app's own scale (`bg-surface`, `text-text1`, `text-micro`) and raw Tailwind palette colors (`amber-500`, `emerald-500`). Pick ONE. Recommended: the app's semantic tokens per `THEMING.md` (success/warning/error/info + surface/text scale), since the rest of the app uses them.

---

## 1. What exists today

Surfaces:

- **Slide-over panel** `src/components/control/AssistantSlideOver.tsx` — 420px right panel, mounted once in `src/App.tsx:579`, toggled via command palette + rail button (`src/App.tsx:399,574`).
- **Transcript + composer** `src/components/control/ConversationView.tsx` — message bubbles, tool cards, empty state, autosizing textarea.
- **Tool call card** `ToolCallCard.tsx`, **confirmation card** `ConfirmationCard.tsx`, **scope chip** `ScopeChip.tsx`, **runtime meta badges** `AssistantRuntimeMeta.tsx`.
- **Markdown** `MarkdownContent.tsx` — hand-rolled ~200-line parser.
- **State** `src/store/controlStore.ts` (zustand), `src/hooks/useControlConversation.ts` (per-conversation items + IPC event streaming), `src/hooks/useControlConversations.ts` (list/create/rename/delete).

Data flow: renderer → `api.control.send` → main-process control agent streams back `control_delta` / `control_tool_call` / `control_confirmation_required` / `control_tool_result` / `control_turn_complete` / `control_error` events; on turn completion the hook refetches the persisted conversation.

## 2. Functional bugs (fix first — these are broken, not ugly)

### 2.1 Full-page view does not exist

`AssistantSlideOver` accepts `onOpenFullView` and renders an "Open full view" button only when the prop is passed (`AssistantSlideOver.tsx:90-102`), but the sole mount site `src/App.tsx:579` passes nothing — the button never renders and there is no full-page assistant route/hub anywhere in `src/hubs/`. **Fix:** create `src/hubs/AssistantHub.tsx` (two-pane: conversation list left, transcript right, reusing `ConversationTranscript`/`Composer`), register it in the app's hub routing + command palette, and pass `onOpenFullView` from `App.tsx`.

### 2.2 Scoped open is dead code

`controlStore.openSlideOver(scope)` stores `pendingScope` (`src/store/controlStore.ts:24-25`) but **nothing ever reads `pendingScope`** (grep confirms: only written). `useControlConversations({ autoCreate })` auto-creates with no scope (`useControlConversations.ts:22-31,63`). So "open assistant scoped to this session" silently produces a workspace-scoped conversation. **Fix:** in `useControlConversations`, read `pendingScope` from the store when auto-creating (`createNew(pendingScope ?? undefined)`), then clear it. Add a session-screen entry point that calls `openSlideOver({ kind: "session", sessionId })`.

### 2.3 Example prompts do nothing in the slide-over

`ConversationTranscript` renders example buttons that call `onPickExample` (`ConversationView.tsx:79-92`), but `AssistantSlideOver.tsx:109-115` passes `examples` **without** `onPickExample` — clicking an example is a no-op. **Fix:** pass `onPickExample={(text) => void convo.send(text)}` (or prefill the composer via the existing `prefill`/`prefillKey` props).

### 2.4 Confirmation card can wedge

`ConfirmationCard` sets `deciding=true` before calling `onConfirm`/`onReject` (`ConfirmationCard.tsx:70-88`) and never resets it. `useControlConversation.confirm` (`useControlConversation.ts:307-318`) optimistically flips the tool to `running` and `await`s IPC with **no try/catch** — if `api.control.confirm` rejects, the card is stuck on "Applying…" forever and the error is an unhandled rejection. Same for `reject` and `cancel`. **Fix:** wrap confirm/reject/cancel in try/catch → `setError`, and reset the card state on failure (simplest: derive `deciding` from `item.status` instead of local state).

### 2.5 Streaming text can be lost/merged

All streamed assistant text goes into a single synthetic item `id: "live-assistant"` (`useControlConversation.ts:240-252`). If the model emits text → tool call → more text within one turn, the second text segment **overwrites** the first in the live view (server refetch later fixes it, causing a visible content jump). On `control_error` the stale `live-assistant` item can linger until refetch resolves. **Fix:** key live segments per assistant message id from the event payload (or per segment index the main process supplies), and drop `live-assistant` items on `control_turn_complete`/`control_error` before refetch merge.

### 2.6 Failed optimistic user message never cleans up

`send` appends `temp-${Date.now()}` user message (`useControlConversation.ts:285-295`); on IPC failure it refetches, but if refetch also fails the temp message stays with no retry affordance. **Fix:** on send failure, mark the temp message `status: "error"` and render a retry button.

### 2.7 Rename uses `window.prompt`

`AssistantSlideOver.tsx:33` — a native browser prompt inside a polished desktop app. **Fix:** inline-editable title (click-to-edit input in header) or the existing Radix `Dialog` from `src/components/ui/dialog.tsx`.

### 2.8 "Web search off" badge is hardcoded

`AssistantRuntimeMeta.tsx:15-17` always renders "Web search off" regardless of actual capability (the toolset includes a search tool — see `electron/main/services/tools/search-tool.ts`). A status chip that lies is worse than none. **Fix:** drive it from a real capability/settings query over IPC, or remove the badge.

## 3. Visual polish (the "looks amateur" list)

### 3.1 Markdown rendering is the #1 issue

`MarkdownContent.tsx` is a hand-rolled parser: **no tables, no nested lists, no task lists, no syntax highlighting, no horizontal rules, no images, no mermaid** — while the docs area already ships a mermaid renderer (`src/components/docs/DocMermaid.tsx`) and `mermaid` is a dependency. A trading assistant answering "what's my open risk" will constantly want tables. Unclosed code fences during streaming render as a runaway `<pre>`. **Fix:** replace with `react-markdown` + `remark-gfm`, code blocks with a copy button + language label, reuse `DocMermaid` for ```mermaid fences, and style via one shared prose class set consistent with the app tokens. Keep the component API (`content`, `className`) so call sites don't change.

### 3.2 Token vocabulary is split-brained

Within the same panel: header uses app tokens (`bg-surface`, `text-text3`, `text-head`, `text-micro` — `AssistantSlideOver.tsx:58-66`), transcript uses shadcn tokens (`bg-primary`, `text-muted-foreground`, `bg-card` — `ConversationView.tsx` throughout), and status pills use raw palette colors (`amber-500`, `emerald-500` — `ToolCallCard.tsx:23-40`; `amber-500/40` — `ConfirmationCard.tsx:34-36`), which bypasses `THEMING.md`'s semantic system (`text-warning`/`bg-warning-dim`/`border-warning-border`, `text-success`, …). **Fix:** normalize every control component to the semantic tokens in `THEMING.md` §Tailwind Classes; status mapping: running→info, needs-you→warning, done→success, failed→error, skipped→muted.

### 3.3 No motion

The slide-over appears/disappears instantly: plain conditional render of a fixed div (`AssistantSlideOver.tsx:49-58`), no enter/exit transition, no overlay fade. `tailwindcss-animate` is already installed. **Fix:** rebuild on Radix `Dialog` (see Core Decision 3) with `data-[state=open]:animate-in slide-in-from-right` / fade for the overlay; this also brings `role="dialog"`, `aria-modal`, focus trap, and Escape handling for free (delete the manual keydown effect at `AssistantSlideOver.tsx:40-47`).

### 3.4 Scroll behavior fights the user

`scrollIntoView` fires on **every** items change (`ConversationView.tsx:61-64`) — during streaming this yanks the view down even if Ken scrolled up to reread something. **Fix:** track "user is at bottom" (scroll listener with a ~80px threshold); auto-scroll only when at bottom; otherwise show a floating "↓ New messages" pill.

### 3.5 Message affordances are missing

No timestamps, no copy-message button, no retry-last-turn, no visual distinction for cancelled/error assistant messages (status exists in the data — `useControlConversation.ts:24` — but is never rendered). **Fix:** hover-reveal action row per assistant message (copy, retry on last), relative timestamp on hover, subtle "cancelled" / error styling keyed off `item.status`.

### 3.6 Tool cards: good bones, rough details

- `humanizeCapability` yields label and summary as the **same string** (`useControlConversation.ts:91-93`), so every card shows its title repeated underneath (`ToolCallCard.tsx:78,98-100`). Fix: have the main process send a human summary of the _arguments_ (e.g. "Pause session Momentum-A"), or hide the summary row when it equals the label.
- Raw JSON dumps for input/result are the only detail view. Fine for debugging, but at minimum give key-value pretty rendering for flat objects and keep JSON behind a "raw" toggle.
- Running state has no elapsed-time indicator; long tools look frozen. Add a lightweight elapsed timer once status is `running` > 2s.

### 3.7 Composer is bare

`ConversationView.tsx:166-207`: no hint row ("Enter to send · Shift+Enter for newline"), no disabled-state explanation when `!activeId`, stop button is a bare square icon with only a `title`. Empty state has just two example prompts (`AssistantSlideOver.tsx:14-17`) — and they're currently dead (bug 2.3). **Fix:** add the hint row in `text-micro text-text3`, 4–6 examples relevant to trading ops (create session, run audit, check risk, explain a trade), and a scope-aware placeholder ("Ask about session Momentum-A…").

### 3.8 Header density

Header stacks title + scope chip + two model badges (`AssistantSlideOver.tsx:59-71`) — the model/web-search badges are metadata noise on every open. **Fix:** move runtime meta into a small settings popover (gear icon) or the conversation list; keep the header to title + scope + actions.

## 4. Missing product surface (professional assistants have these)

1. **Conversation history UI** — `useControlConversations` supports list/rename/delete, but no surface renders the list; the slide-over can only create new. The delete API (`remove`) is entirely unreachable from the UI. Add a conversation switcher (dropdown in slide-over header; full list pane in the new AssistantHub).
2. **Auto-titling** — conversations are presumably "New conversation" until manually renamed via `window.prompt`. Add main-process auto-title after the first exchange (one cheap LLM call), like every mainstream assistant.
3. **Keyboard shortcut surfaced** — palette entry exists (`App.tsx:397-399`); print the shortcut in the rail button tooltip and empty state.
4. **Persistent draft** — composer text is lost if the panel closes; keep per-conversation draft in the zustand store.

## 5. Execution order for the fixer AI

1. Bugs 2.1–2.8 (small, isolated, high value). Verify each in the running app.
2. Markdown renderer swap (3.1) — biggest visible win.
3. Radix Dialog rebuild + motion + a11y (3.3), token normalization (3.2).
4. Scroll/affordances/composer/header (3.4–3.8).
5. History UI + auto-title + drafts (section 4), then AssistantHub full view (2.1's larger half).

After each visual step: launch the app, screenshot the assistant panel (`scripts/ui-snap.ts`), and compare against this doc's target journey. Do not mark a step done from code alone.
