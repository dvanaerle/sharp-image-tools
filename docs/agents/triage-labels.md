# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

Because issues live as local markdown files, the "label" is the value written on the `Status:` line near the top of each issue file.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

Two further labels have no counterpart in the skills' five roles, because they describe work
that has already left triage:

| Label in our tracker | Meaning                                                  |
| -------------------- | -------------------------------------------------------- |
| `claimed`            | An agent or human has started; not yet finished          |
| `resolved`           | Built and verified. Carries the date, and the commit      |

A `resolved` line is expected to say *where* — the date and the commit or branch — and to
record any criterion that shipped differently from the ticket, so the ticket stays readable as
the account of what happened. Closing a ticket also means ticking its acceptance criteria from
`- [ ]` to `- [x]`; a `resolved` status over unticked criteria is the signature of a status
line written without the work being checked.

## `wontfix` covers a park, and says what would un-park it

There is no separate label for *not now*. A ticket that is wanted but not being built is
`wontfix` with a **re-open trigger** — the condition that would make it worth looking at
again — and it moves to `.out-of-scope/`, where its measurement is kept as evidence. That is
already how every file in that folder is written.

The trigger is the condition, not a date. `wontfix — parked, until we have time` is a refusal
that has not admitted it; write what would change our minds, or write that nothing would.

## Words that are not labels

These have been written on `Status:` lines and are not in the vocabulary. Each has a
replacement:

| Written | Use instead |
| ------- | ----------- |
| `closed` | `resolved` or `wontfix`, whichever happened. Retired 2026-08-13. |
| `superseded` | `resolved — superseded by NN` — the work happened, in another ticket |
| `parked` | `wontfix`, with the re-open trigger on the same line |
| `spec` | not a status. See below. |

## A PRD carries no triage label

A PRD is not an agent task, so it takes no triage role: a `Status: ready-for-agent` on a PRD
invites an agent to build the whole feature in one session, against a repo whose rule is one
ticket per session. A PRD's `Status:` line, if it has one, describes the *feature's* progress
in plain words — `live, half delivered`, `every issue resolved` — and never a triage label.
The same holds for a `TRIAGE.md`, a `PROTOTYPE.md` or any other record that is not a unit of
work. The exception is `resolved`, which a PRD may carry once every issue under it is closed.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.
