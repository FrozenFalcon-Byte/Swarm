# tagkit (demo target repo)

A tiny library the swarm maintains in the demo. It deliberately contains
flaky tests with real root causes:

* `normalize_tags` and `scopes_for` build lists from sets, so their order
  depends on `PYTHONHASHSEED` and changes between processes.
* `backoff_delays` adds jitter that can exceed the exponential step, so the
  "delays increase" test fails roughly a quarter of the time.
* `parse_date` has an ordinary (non-flaky) end-of-month bug.
