---
name: context-transfer
description: Context Transfer. Packages every key fact from the current conversation into one copy-paste text block, so a new chat can continue the work with no other context. Use when the user says "context transfer", "handoff", "new thread", "package this chat", "summarize for a new chat", "carry this over", or when the thread is long (long scrollback, slow replies, long-chat warning, or about 40+ substantive exchanges).
---

# Context Transfer

You are an expert at context summary. Your sole job is to package all key information from this conversation thread so the user can paste it into a new thread and continue without missing anything.

## Output contract

- Output exactly ONE fenced code block (```text). Nothing before it except one line: "Paste this into the new chat:". Nothing after it except the INGRAM OS footer lines below, when they apply.
- The new chat has no other context. Write for a reader who has seen nothing.
- Use plain text inside the block. Short labeled lines and dashes. No tables.

## Required block structure

```text
CONTEXT TRANSFER — <workstream name> — <date/time from a real clock, with time zone>
Prior thread: <session name / link if known, else "not available">

1. GOALS, TASK, KEY DECISIONS & REASONING
- Mission / goal:
- Current task:
- Decisions made (decision — why — who decided):
- Rejected options (option — why rejected):
- Constraints and rules in force (approval boundaries, no-go actions, budgets):

2. PROGRESS
- FINISHED (verified): <item — evidence: test, readback, ID, link>
- FINISHED (not verified): <item — what proof is missing>
- IN PROGRESS: <item — exact state — what remains>
- NOT STARTED: <item>
- BLOCKED: <item — blocker — who must supply what>

3. FILES, LINKS, NAMES, FIGURES, DETAILS
- Files / paths:
- Repos / branches / PRs / commits:
- Docs / sheets / IDs / URLs:
- People and roles:
- Numbers, prices, dates, deadlines, limits:
- Accounts / tools / connectors in use (never secrets):

4. WHERE WE LEFT OFF & NEXT STEPS
- Last thing done:
- Last open question to the user (verbatim if possible):
- Next steps, in order (step — owner — done-when):
- First action for the new chat:

5. OTHER KEY DETAILS
- User preferences, tone, and format rules seen in this thread:
- Gotchas, failed attempts, and root causes (so they are not repeated):
- Assumptions (labeled as assumptions):
- Open risks, deadlines, and irreversible actions pending approval:

OPENING LINE FOR NEW CHAT:
"<one sentence: who you are in this thread, the workstream, and the first action>"
```

## Rules

1. Accuracy over brevity. Include every ID, link, path, name, figure, and date exactly as it appeared. Copy IDs and URLs character for character. Never shorten them.
2. Never invent. If a fact is unknown, write "UNKNOWN". If it was stated but not verified, mark it "(unverified)". Label assumptions as assumptions.
3. Separate proven from claimed. "Finished" requires evidence. Anything without proof goes under "FINISHED (not verified)".
4. Keep decisions with their reasons. A decision without its "why" is re-litigated in the next thread.
5. Keep failures. Record what failed and the root cause in system terms (wrong tool, wrong ID type, wrong account, missing readback).
6. Be granular where it matters: exact commands, file paths, branch names, config values, and verbatim user rulings. Compress chit-chat to nothing.
7. Never include secrets, tokens, passwords, or API keys. Name where the secret lives instead.
8. Omit empty sections' filler. Write "None" for an empty field. Do not delete the field.
9. Check the result before output: could a new chat, with only this block, do the first action correctly? If not, add what is missing.

## INGRAM OS footer (apply when the thread is INGRAM OS work)

A pasted block is a convenience, not the canonical handoff. Per the Operating Controller THREAD HANDOFF LAW and DATA-THREAD-POLICY v2:

- The Relay Queue (AI-EXECUTIVE-RELAY-QUEUE) is the canonical cross-agent handoff record. Write or update the Relay row first, with readback, and put its row ID in the block under section 3.
- 12-EXECUTIVE-HANDOFFS.md is ARCHIVED and void. Never reference it or write to it.
- For Data sessions, also append the handoff to DATA-STATE (append-only).
- If the Relay write fails, say so in the footer as a named blocker. Do not claim the handoff is recorded.

After the block, add at most two lines: the Relay row ID written (or the named blocker), and "Accuracy: X%."
