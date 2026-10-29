---
name: lab-report
description: Create a Lab 3 activity report for Coin Dash from local agent session logs and Git history, with a validated JSON export and an offline HTML report page. Use for the pre-lab practice report or the pair's final lab report.
---

# Lab report

Create the student's Lab 3 session report data. Use details already supplied; ask for missing inputs: student name, a short laptop label (for example dana-laptop), the game repository path (discover its worktrees with `git worktree list --porcelain`), and the lab's start and end time with timezone. For a practice run before the lab, use a window that covers the practice session.

## Find the sessions

For a practice run, use a fresh reporting session so the inspection session can be included.
Find the saved session logs for this repository and its worktrees inside that time window. Claude Code keeps them under ~/.claude/projects; Codex keeps them under ~/.codex/sessions (or $CODEX_HOME/sessions). Look at the actual files and their format instead of assuming one. Include finished sessions, interrupted ones, and subagents you can find, in every worktree. Leave out the session that is writing this report. If you cannot read the logs, say so and ask the student where they are. Do not claim a collection that did not happen, and do not change the original logs.

Write a small script to do the parsing and the arithmetic. Do not estimate times from reading the conversation. Skip duplicate records from forks and resumes. Put only derived intervals and short labels in the output, never transcript text or secrets.

## Two kinds of time

Working: from the student's message until the agent's final reply to it, including all the tool calls in between.
Waiting: from the moment the agent asked the student a question or for permission until they answered.
Record nothing else. The page itself shows the gap between one turn's end and the next message as idle (the agent done, waiting for its next task), so do not write idle intervals. A tool result is not a human message, and a progress message is not a final reply. If the log does not show when a turn ended, leave the gap rather than inventing one. Clip everything to the lab window; intervals inside one session must not overlap.

For each session also record "start", the time of the first human message, and "end", the time of the agent's last reply (or of the last human message, if that came later). Clip these bounds to the lab window too. Every interval lies between them; omit sessions entirely outside the window.

## The history graph

Run this in the game repository and copy its output into "history" exactly, escape codes included; the report page turns them into colours:
```sh
git log --graph --oneline --decorate --all --color=always
```

## What the student did

Write two or three sentences on what this laptop accomplished, from the Git history and the sessions. Say which features were merged and which were only tried. The student will check and correct it and add their own observations. Leave observations empty unless the student supplies them; logs cannot establish where their attention was.

## Output

Write `reports/<laptop>-report.json` in the game repository in this shape, with example set to false. Keep the parser and generated files in `reports/` (ignored by Git); do not commit or push them.

```json
{
  "version": 2,
  "example": false,
  "lab": { "start": "2026-10-20T07:00:00Z", "end": "2026-10-20T08:30:00Z" },
  "laptops": [
    {
      "id": "dana-laptop",
      "student": "Dana",
      "summary": "Added a pause key and a colour theme. Started touch controls but did not finish them.",
      "observations": [],
      "notes": "",
      "history": "* a1f2c3d (HEAD -> main) Merge branch 'feature/pause'\n...",
      "sessions": [
        {
          "id": "dana-pause",
          "label": "Pause key",
          "tool": "Claude",
          "parent": null,
          "start": "2026-10-20T07:16:00Z",
          "end": "2026-10-20T07:34:00Z",
          "intervals": [
            { "start": "2026-10-20T07:16:00Z", "end": "2026-10-20T07:23:00Z", "state": "working" },
            { "start": "2026-10-20T07:23:00Z", "end": "2026-10-20T07:28:00Z", "state": "waiting" }
          ]
        }
      ]
    }
  ]
}
```

Timestamps are ISO 8601 with a timezone. "parent" is the id of the session that started a subagent, or null. "notes" is for anything the logs could not show, such as a session whose end time is missing.

## Check it against the page

The bundled [report page](assets/report.html) is relative to this skill folder. Its validate() function is the exact set of checks the page applies when a file is loaded; read it, and run your JSON through those checks before you hand it over (for example by extracting the function and calling it with node, or by opening the page in a browser and loading the file). Fix whatever it rejects. Then spot-check a few intervals against the log timestamps, and give the student the file and one short paragraph on anything that is missing.

## Hand over the report

Copy the bundled page to `reports/report.html` without changing the skill's copy. Give the student paths to the page and JSON. Explain that the page initially shows fictional example data: open it, load the JSON, and check the summary against the game. For the pair's final report, select both laptops' JSON exports together (loading replaces the current data), then use Save HTML. Both exports must use the same time window and different laptop IDs. Transfer only derived JSON, not original logs. The saved HTML works offline.
