<h1>Ancient Code</h1>

**What would it cost to hand this codebase to someone else?**

Six questions about a system, five of them measured from the repository itself.
No account, no upload, no configuration. Your code never leaves your machine.

```bash
npx ancient-code .
```

```
  ANCIENT CODE / transferability
  orders-platform
  ========================================================================
  [ RISK ]  How many people understand each part?
            3 of 11 modules depend on one person
  [  ok  ]  Is there a safety net for changes?
            tests run in CI and live next to the code they cover
  [ watch]  How much scaffolding did nobody remove?
            41 in source, 12 in tests (kept, not work), 9 untouched for 3+ years
  [ RISK ]  Does it build from scratch?
            3 things a new team cannot find out from the repository alone
  [ watch]  Is the documentation real?
            2 instructions point at something that is not there any more
  [  --  ]  Who holds the keys?
            not measured in this run
```

## Why this exists

You pay a vendor for a system. Six years later you ask what it would take to
move it somewhere else, and every answer you get is an opinion: theirs, or a
consultant's who read the code for two days. Meanwhile the questions that decide
the answer are all answerable from the repository, and nobody asks them.

- **How many people understand each part.** From authorship history, not from a
  staffing plan. If one person made 80% of the changes to payments, that is a
  fact about your risk, not a comment about them.
- **Is there a safety net.** Whether tests exist and whether anything runs them.
- **How much scaffolding nobody removed.** Code written because of somebody
  else's bug, still standing after the bug was fixed. Measured by
  [Ancient Fences](https://github.com/Marcin1000/ancient-fences), which ships
  with this.
- **Does it build from scratch.** What a new team cannot find out from the
  repository alone: unpinned toolchains, missing lockfiles, undocumented steps.
- **Is the documentation real.** Not whether it is good, which nobody can
  measure, but whether it still describes this repository: commands that are
  gone, paths that were renamed, day-one questions never answered.
- **Who holds the keys.** Domains, servers, certificates, app-store accounts.
  This one needs a person, and the report says so instead of quietly leaving it
  out.

## Options

```
--since=YEARS       how far back to read authorship history (default 3)
--no-fences         skip the scaffolding question (faster)
--fences=FILE       use the output of "ancient-fences --json" instead of
                    scanning here
--run-build         clone into a temporary directory and actually install and
                    build it. Runs the project's own scripts, so use it only in
                    a disposable sandbox
--report[=FILE]     write the client-facing HTML report
--json              full machine-readable output
```

## What it does not do

**It does not run your build unless you ask.** `--run-build` executes the
project's own scripts, which is the only honest way to answer "does it build",
and also a good way to run a stranger's code. It is off by default and it says
in the report which of the two answers you are reading.

**It does not judge people.** Ownership is a measure of how knowledge is spread,
not of anyone's work. One person carrying a module is a risk to the business and
usually a burden on that person.

**It does not send anything anywhere.** Everything is measured locally. The only
network call in the whole project is Ancient Fences asking a public tracker
whether an issue is still open, and only when you pass `--check`.

## Requirements

Node 20 or newer, and `git` on the PATH with the repository's full history. In a
shallow clone git dates every line to the day it was fetched, so ages cannot be
measured, and the report says that rather than printing a confident zero.

## Using it from your own code

Each question is a function, and they can be called separately. The command
line runs exactly these, so nothing here is a second implementation that can
drift from what the report says.

```js
import { ownership, safetyNet, assess, renderText } from 'ancient-code';

const repo = '/path/to/repo';
const own = await ownership(repo, { sinceYears: 3 });
const safety = await safetyNet(repo);

const a = assess({ own, safety });
console.log(a.ownershipVerdict);          // { level: 'risk', why: '...' }
console.log(a.buildVerdict.level);        // 'unmeasured': it was not passed in
console.log(renderText('my-repo', a, own));
```

Whatever is not passed to `assess` comes back as `unmeasured`, never as a pass.
The same happens when git cannot be read: an empty history is a failure to
measure, not a codebase whose knowledge is well spread.

## Real reports

Four public projects, measured with this tool and published in full:
[ancientcode.net/reports](https://ancientcode.net/reports/).

## Tests

```bash
npm test
```

Offline, no fixtures downloaded, no network.

## Licence

MIT.
