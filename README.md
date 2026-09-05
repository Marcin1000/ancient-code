<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/readme-banner-code.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/readme-banner-code-light.png" alt="Ancient Code" width="100%">
</picture>

<p align="center">
  <a href="https://www.npmjs.com/package/ancient-code"><img alt="npm" src="https://img.shields.io/npm/v/ancient-code?color=8B5514&labelColor=1E242B&style=flat-square"></a>
  <img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-8B5514?labelColor=1E242B&style=flat-square">
  <img alt="Node 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-8B5514?labelColor=1E242B&style=flat-square">
  <a href="https://ancientcode.net/reports/"><img alt="Live reports" src="https://img.shields.io/badge/live%20reports-ancientcode.net-8B5514?labelColor=1E242B&style=flat-square"></a>
</p>

# Ancient Code

**What would it cost to hand this codebase to someone else?**

Six questions about a system, five of them measured from the repository itself.
No account, no upload, no configuration. Your code never leaves your machine.

```bash
npx ancient-code .
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/shot-code.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/shot-code-light.png" alt="Ancient Code output for webpack: six questions, five with a verdict, the sixth marked as needing a person" width="100%">
</picture>

That is a real run against a full clone of webpack, not a mock-up. Clone webpack
yourself and you get the same lines. The same output for webpack, puppeteer,
eslint and express is published in full at
**[ancientcode.net/reports](https://ancientcode.net/reports/)**.

## Why it matters

Ancient Code turns maintainability and knowledge-transfer risk into signals you
can put in front of somebody who does not read code.

Each of these has a name in a board meeting and no number behind it. This gives
each one a number, measured from evidence already sitting in the repository:

| The worry | What is actually measured |
| --- | --- |
| **Vendor dependency** | How much of the system only one supplier has ever touched, from authorship history |
| **Bus factor** | Per module, how many people would have to leave before half the knowledge goes with them |
| **Reproducibility risk** | Whether a clean checkout states its toolchain, locks its dependencies and documents its build |
| **Undocumented systems** | Whether the documentation still describes this repository, and which day-one questions it never answers |
| **Technical debt that is provably dead** | Workarounds still standing after the problem they were built for was fixed |
| **Key-person and access risk** | Left open. Domains, servers and credentials are a question about your organisation, not your repository |

The last row is the point. Five questions get an answer, the sixth is marked
`not measured` rather than guessed at, and the report says which is which.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/diagram-code.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/diagram-code-light.png" alt="Four stages: your repository, evidence already there, six questions with verdicts, a report you can forward" width="100%">
</picture>

Nothing is inferred from a language model or a heuristic about code style. Every
verdict traces back to a commit, a file or a manifest you can open yourself.

## The six questions

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

## A report you can forward

`--report` writes the same measurement as one HTML file, with no scripts and no
external requests. It is meant for whoever signs the invoices, not for the
person who ran the command.

```bash
npx ancient-code . --report=transferability.html
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/report-code.png">
  <img src="https://raw.githubusercontent.com/Marcin1000/ancient-code/main/assets/report-code-light.png" alt="The HTML report: six questions with verdicts, measured on webpack" width="100%">
</picture>

## Real reports, on code you already know

Four well-known open-source projects, measured with this exact command and
published in full, contributors labelled rather than named:

**[ancientcode.net/reports](https://ancientcode.net/reports/)**

They are maintained by excellent engineers, and that is the point. This is not
negligence, it is blindness that nothing on the market corrects.

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

An unknown option stops the run with exit code 2 rather than being ignored. A
mistyped flag that still produces a confident-looking report is worse than no
report at all.

## What it does not do

**It does not run your build unless you ask.** `--run-build` executes the
project's own scripts, which is the only honest way to answer "does it build",
and also a good way to run a stranger's code. It is off by default and the
report says which of the two answers you are reading.

**It does not judge people.** Ownership is a measure of how knowledge is spread,
not of anyone's work. One person carrying a module is a risk to the business and
usually a burden on that person.

**It does not send anything anywhere.** Everything is measured locally. The only
network call in the whole project is Ancient Fences asking a public tracker
whether an issue is still open, and only when you pass `--check`.

**It never reports a pass for something it did not measure.** Anything skipped,
or that could not be read, comes back as `not measured` with the reason.

## Requirements

Node 20 or newer, and `git` on the PATH with the repository's full history. In a
shallow clone git dates every line to the day it was fetched, so ages cannot be
measured, and the report says that rather than printing a confident zero.

## Using it from your own code

Each question is a function, and they can be called separately. The command line
runs exactly these, so nothing here is a second implementation that can drift
from what the report says.

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

## Tests

```bash
npm test
```

No test framework and no mocked filesystem. Every test builds a real repository
in a temporary directory, runs real `git` against it, and deletes it afterwards.
The suite also runs against this repository on every push.

## Licence

MIT. Free now, free later, and there is no paid tier behind it.
