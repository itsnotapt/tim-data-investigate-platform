# Instance files

Mounted read-only at `/etc/tim` by `deploy/compose.prod.yaml` (`TIM_CONFIG_DIR`, this directory by default). The api reads only the files `deploy/.env` names. It reads them only at startup.

| File | Variable in `deploy/.env` |
|---|---|
| `actions/` | `TIM_ACTIONS_DIR=/etc/tim/actions` |
| `connections.yaml` | `TIM_CONNECTIONS_FILE=/etc/tim/connections.yaml` |
| `labels.yaml` | `TIM_LABELS_FILE=/etc/tim/labels.yaml` |

The examples here change nothing as shipped. Edit them, or point `TIM_CONFIG_DIR` at your own directory. The formats are in [docs/actions.md](../../docs/actions.md).
