---
status: accepted
date: 2026-10-31
---

# A demo instance needs no accounts

Analysts who want to try TIM, or see it shown, often have Docker but no Entra app registration or Kusto cluster, and every connection and sign-in TIM had needed one. A demo instance runs against a local Kusto emulator with no credentials, and signs analysts in by name, through two more development-only modes that refuse to run in production like the others in [0011](0011-development-only-modes.md).

- **`auth: none` on `kusto`.** A Kusto connection may have no auth, so its queries are sent without a token. Only `none` accepts an `http://` cluster address. Action files name the connection, not its auth, so the same action files run against a real cluster when the connection becomes `obo`.
- **Stub sign-in in the web container.** The web container, in development mode, can replace Entra with a "Who are you?" screen: the analyst types a name or picks one of the demo analysts, and the browser remembers it. The api already runs each request as the analyst a stub token names when auth is disabled, so several analysts can share annotations, comments and share links.
- **Loopback by default.** The demo instance listens on `127.0.0.1`. Listening on the network is an opt-in setting, and anyone who can reach it can sign in as anyone.
- **Never in production.** The api refuses `auth: none` and the web container refuses stub sign-in when `TIM_ENVIRONMENT` is `production`.

Decided by the user. Related: [0005](0005-auth-entra-popup-obo.md), [0011](0011-development-only-modes.md).

## Considered Options

| Option | Pros | Cons |
|---|---|---|
| The analyst's own free Kusto cluster | Real Kusto; no new auth mode | Needs a Microsoft account, a cluster and an Entra app registration before the first query |
| A separate `kusto_emulator` connection type | `kusto` keeps only real auth | `kql_query` would accept two connection types, and the action files couldn't move to a real cluster unchanged |
| One fixed dev user | Nothing to choose at sign-in | Can't show what analysts share: annotations, comments and share links |
| A `demo` environment beside `development` and `production` | Demo rules separate from developers' | A third mode to validate everywhere, for the same shortcuts |

## Consequences

- TIM can be tried with Docker alone.
- The dev Compose stack's web container signs in without an app registration too.
- On the network, a demo instance has no authentication; the opt-in says so.
