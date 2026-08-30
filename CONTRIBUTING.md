# Contributing

The rule that matters more than style: **a measurement that cannot be trusted
is worse than no measurement.** If a check cannot answer a question, it says so.
It never prints a zero that reads like an all clear.

Two of the tests exist because that rule was broken once:

- a shallow clone dates every line to the day it was fetched, so ages are
  reported as not measured rather than as zero
- a comment in a test that links to an issue is a regression test, not
  scaffolding to delete, so those are counted apart and never listed as work

## Running it

```bash
npm install
npm test
node bin/ancient-code.mjs .
```

Tests are offline: no fixtures downloaded, no network, no repository cloned
except the temporary ones the tests create themselves.

## Sending a change

Open an issue first if it changes what a verdict means. A pull request that
adds a check should come with the case that made you want it.
