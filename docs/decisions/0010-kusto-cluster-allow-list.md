# 0010. Kusto cluster allow-list

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** the user
- **Related:** [0005](0005-auth-entra-popup-obo.md), [0009](0009-obo-token-exchange.md), [configuration](../configuration.md), [api](../api.md)

## Context
The caller supplies the cluster in the request body, and the API then sends a Kusto token for that cluster. Without a check, a caller could point the API, holding a freshly exchanged token, at any host.

## Decision
`validate_cluster_url` in `api/src/tim_api/kusto/validation.py` runs before any token is requested. It is called by the schema endpoint (`api/src/tim_api/kusto/router.py`) and the query endpoint (`api/src/tim_api/query_runs/router.py`).

- **Shape:** an absolute `https://` URL with no credentials, query, fragment or path, and port omitted or 443. Whitespace, control characters, backslashes and IP literals are refused. The host is lowercased and converted to ASCII (punycode). The result is normalised to `https://<host>`.
- **Allow-list:** one list of patterns, `TIM_ALLOWED_KUSTO_HOSTS`, validated at startup. A pattern is an exact host, `*.domain` (exactly one label before the domain) or `**.domain` (one or more labels). Matching is on whole labels, so `evilkusto.windows.net` does not match `*.kusto.windows.net`.
- **Default:** `**.kusto.windows.net`. Unset or blank uses it. Fabric and sovereign clouds opt in by listing their domains, e.g. `**.kusto.fabric.microsoft.com`.
- A rejected cluster is a 400 `cluster-not-allowed`, with the reason under `errors.cluster`.
- The tag-ingestion cluster is not checked here. It is operator configuration (`TIM_TAG_CLUSTER_URI`, https only), not request input.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| No check | Most flexible | A caller can send the user's Kusto token to any host |
| Exact hosts only | Tightest | Every new cluster needs a config change |
| Suffix list | Covers all Kusto clusters with no upkeep | Cannot express an exact host or a single-label wildcard |
| Separate host and suffix lists with a mode switch | Familiar | Two settings that conflict; strict mode depends on one list being non-empty |
| Full glob or regex | Most expressive | Easy to get wrong; a bad pattern can silently allow too much |

## Consequences
- One setting covers locked-down and broad deployments.
- Regional clusters (`<name>.<region>.kusto.windows.net`) are covered by the default; `*.` patterns cover only one label.
- Fabric and sovereign clouds need an explicit entry.
- A malformed pattern stops the api at startup instead of being ignored.
