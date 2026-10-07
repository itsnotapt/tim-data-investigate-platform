# 0010. Kusto cluster allow-list

- **Status:** Accepted
- **Date:** 2026-10-06
- **Deciders:** the user
- **Related:** [0005](0005-auth-entra-popup-obo.md), [0009](0009-obo-token-exchange.md), [configuration](../configuration.md), [api](../api.md)

## Context
The caller supplies the cluster in the request body, and the API then sends a Kusto token for that cluster. Without a check, a caller could point the API, holding a freshly exchanged token, at any host.

## Decision
`validate_cluster_url` in `api/src/tim_api/kusto/validation.py` runs before any token is requested. It is called by the schema endpoint (`api/src/tim_api/kusto/router.py`) and the query endpoint (`api/src/tim_api/query_runs/router.py`).

- **Shape:** an absolute `https://` URL with no credentials, query, fragment or path, and port omitted or 443. Whitespace, control characters, backslashes and IP literals are refused. The host is lowercased and converted to ASCII (punycode). The result is normalised to `https://<host>`.
- **Allow-list, one mode at a time:**
  - If `TIM_ALLOWED_KUSTO_HOSTS` is set, only those exact hosts are accepted. Suffixes are ignored.
  - Otherwise the host must end with one of `TIM_ALLOWED_KUSTO_SUFFIXES` (default `.kusto.windows.net`, `.kusto.fabric.microsoft.com`) on a label boundary, with at least one label before it.
- A rejected cluster is a 400 `cluster-not-allowed`, with the reason under `errors.cluster`.
- The tag-ingestion cluster is not checked here. It is operator configuration (`TIM_TAG_CLUSTER_URI`, https only), not request input.

## Alternatives considered
| Option | Pros | Cons |
|---|---|---|
| No check | Most flexible | A caller can send the user's Kusto token to any host |
| Exact hosts only | Tightest | Every new cluster needs a config change |
| Suffixes only | Covers all Kusto clusters with no upkeep | Too broad for a locked-down deployment |
| Hosts and suffixes both applied | One more knob | The two lists would conflict. A non-empty host list is how an operator opts into strict mode |

## Consequences
- The default works for public Azure and Fabric. Sovereign clouds must set the suffixes.
- Templates store a `cluster` field that is not checked when saved. It is checked when a query runs or the schema is fetched, so a bad template fails there with a 400.
