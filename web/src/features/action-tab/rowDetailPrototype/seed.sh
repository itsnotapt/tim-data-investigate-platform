#!/usr/bin/env bash
# PROTOTYPE (#170, throwaway): gives a few ids of the prototype rows labels, tags, comments and a
# history from several analysts. Usage: seed.sh <api base url>.
set -euo pipefail
api="$1"

change() { # <analyst> <json body>
  curl -sf -X PATCH "$api/api/annotations" \
    -H "Authorization: Bearer dev:$1" -H 'Content-Type: application/json' -d "$2" >/dev/null
}

change bob@example.com '{"ids":["evt-0001"],"label":"escalated","addTags":["encoded-powershell","finance"]}'
change bob@example.com '{"ids":["evt-0001"],"comment":"Parent is WINWORD with a .docm from Downloads. Escalating to IR."}'
change alice@example.com '{"ids":["evt-0001"],"label":"malicious","addTags":["ir-2026-114","c2:185.143.x.x"]}'
change alice@example.com '{"ids":["evt-0001"],"comment":"Decoded the -EncodedCommand: a TCP reverse shell to 185.143.223.19:443.\nSame hash on WS-FIN-0142, LT-HR-0555 and WS-ENG-0031.\nContained all three at 14:20 UTC; see the IR ticket for the timeline."}'
change carol@example.com '{"ids":["evt-0001"],"comment":"Confirmed with the user: they opened the invoice from an external sender at 13:58."}'

change carol@example.com '{"ids":["evt-0002"],"label":"benign","comment":"Nightly reporting job; matches the change record."}'

change bob@example.com '{"ids":["evt-0003"],"label":"escalated","addTags":["lolbin","rundll32","needs-owner","q3-hunt","persistence?"]}'

change alice@example.com '{"ids":["evt-0005"],"comment":"Looking at this one now."}'
echo "Seeded annotations on evt-0001, evt-0002, evt-0003 and evt-0005."
