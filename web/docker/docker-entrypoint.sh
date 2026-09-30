#!/bin/sh
# TIM web container entrypoint: validate env, render /config.js and the nginx conf, exec nginx.
# See web/README.md for the environment variables.
#
# Test/override hooks (all optional):
#   TIM_HTML_DIR         where config.js is written        (default /usr/share/nginx/html)
#   TIM_NGINX_TEMPLATE   nginx conf template               (default /opt/tim/nginx.conf.template)
#   TIM_NGINX_CONF       rendered nginx conf               (default /etc/nginx/conf.d/default.conf)
#   TIM_ENTRYPOINT_DRY_RUN=1   render files, then exit 0 instead of exec'ing nginx
set -eu

HTML_DIR=${TIM_HTML_DIR:-/usr/share/nginx/html}
NGINX_TEMPLATE=${TIM_NGINX_TEMPLATE:-/opt/tim/nginx.conf.template}
NGINX_CONF=${TIM_NGINX_CONF:-/etc/nginx/conf.d/default.conf}

fail() {
    echo "tim-web: $*" >&2
    exit 1
}

TIM_ENVIRONMENT=${TIM_ENVIRONMENT:-production}
case "$TIM_ENVIRONMENT" in
    development | production) ;;
    *) fail "TIM_ENVIRONMENT must be 'development' or 'production' (got '$TIM_ENVIRONMENT')" ;;
esac

# --- required variables ---------------------------------------------------------------
required="BACKEND_URI REDIRECT_URI AUTH_CLIENT_ID AUTH_TENANT_ID TAG_CLUSTER"
if [ "$TIM_ENVIRONMENT" = production ]; then
    required="$required AGGRID_LICENSE"
fi
missing=""
for name in $required; do
    eval "value=\${$name-}"
    if [ -z "$value" ]; then
        missing="$missing $name"
    fi
done
if [ -n "$missing" ]; then
    fail "missing required environment variable(s):$missing"
fi

# --- validation -------------------------------------------------------------------------
is_http_url() {
    printf '%s' "$1" | grep -Eq '^https?://[^[:space:]]+$'
}

BACKEND_URI=$(printf '%s' "$BACKEND_URI" | sed 's|/*$||')
# Scheme + host[:port] only. A path would change how nginx forwards /api/ (BUG-10 class).
printf '%s' "$BACKEND_URI" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
    || fail "BACKEND_URI must be http(s)://host[:port] with no path (got '$BACKEND_URI')"
is_http_url "$REDIRECT_URI" || fail "REDIRECT_URI must be an http(s) URL"
is_http_url "$TAG_CLUSTER" || fail "TAG_CLUSTER must be an http(s) URL"
printf '%s' "$AUTH_TENANT_ID" | grep -Eq '^[A-Za-z0-9.-]+$' \
    || fail "AUTH_TENANT_ID must be a tenant GUID or domain name"

TAG_DATABASE=${TAG_DATABASE:-Research}
API_BASEPATH=${API_BASEPATH-}
AGGRID_LICENSE=${AGGRID_LICENSE-}
HELP_WIKI_URI=${HELP_WIKI_URI-}
HELP_ISSUE_URI=${HELP_ISSUE_URI-}
DEFAULT_CLUSTERS=${DEFAULT_CLUSTERS-}

if [ -n "$DEFAULT_CLUSTERS" ]; then
    printf '%s' "$DEFAULT_CLUSTERS" | jq -e 'type == "array"' >/dev/null 2>&1 \
        || fail "DEFAULT_CLUSTERS must be a JSON array of {name, clusters, databases}"
else
    DEFAULT_CLUSTERS='[]'
fi

# --- config.js --------------------------------------------------------------------------
# jq does all JSON escaping. "<" is additionally emitted as < so the file stays safe even
# if it is ever inlined in HTML. Empty optional values are omitted so the app's own defaults
# apply.
mkdir -p "$HTML_DIR"
config_tmp="$HTML_DIR/.config.js.$$"
{
    printf 'window.appConfig = '
    jq -n \
        --arg clientId "$AUTH_CLIENT_ID" \
        --arg tenant "$AUTH_TENANT_ID" \
        --arg redirectUri "$REDIRECT_URI" \
        --arg apiEndpoint "$API_BASEPATH" \
        --arg agGridLicenseKey "$AGGRID_LICENSE" \
        --arg wikiUri "$HELP_WIKI_URI" \
        --arg issueUri "$HELP_ISSUE_URI" \
        --arg tagCluster "$TAG_CLUSTER" \
        --arg tagDatabase "$TAG_DATABASE" \
        --argjson defaultClusters "$DEFAULT_CLUSTERS" \
        '{
            auth: {
                clientId: $clientId,
                authority: ("https://login.microsoftonline.com/" + $tenant)
            },
            redirectUri: $redirectUri,
            apiEndpoint: $apiEndpoint,
            agGridLicenseKey: $agGridLicenseKey,
            wikiUri: $wikiUri,
            issueUri: $issueUri,
            tagCluster: $tagCluster,
            tagDatabase: $tagDatabase,
            defaultClusters: (
                if ($defaultClusters | length) > 0 then $defaultClusters
                else [{name: "Cluster", clusters: [$tagCluster], databases: [$tagDatabase]}]
                end
            )
        } | with_entries(select(.value != ""))' \
        | sed 's/</\\u003c/g'
    printf ';\n'
} >"$config_tmp"
mv "$config_tmp" "$HTML_DIR/config.js"

# --- nginx conf -------------------------------------------------------------------------
# Resolver for the runtime-resolved backend: NGINX_RESOLVER, else the first nameserver in
# /etc/resolv.conf (IPv6 literals bracketed), else Docker's embedded DNS.
NGINX_RESOLVER=${NGINX_RESOLVER:-}
if [ -z "$NGINX_RESOLVER" ] && [ -r /etc/resolv.conf ]; then
    NGINX_RESOLVER=$(awk '$1 == "nameserver" { print $2; exit }' /etc/resolv.conf)
    case "$NGINX_RESOLVER" in
        *:*) NGINX_RESOLVER="[$NGINX_RESOLVER]" ;;
    esac
fi
NGINX_RESOLVER=${NGINX_RESOLVER:-127.0.0.11}
printf '%s' "$NGINX_RESOLVER" | grep -Eq '^[][A-Za-z0-9.:-]+$' \
    || fail "NGINX_RESOLVER contains invalid characters"

# Both substituted values were validated above, so they are safe for sed and for nginx.
mkdir -p "$(dirname "$NGINX_CONF")"
sed -e "s|@BACKEND_URI@|$BACKEND_URI|g" -e "s|@NGINX_RESOLVER@|$NGINX_RESOLVER|g" \
    "$NGINX_TEMPLATE" >"$NGINX_CONF"

if [ "${TIM_ENTRYPOINT_DRY_RUN:-}" = 1 ]; then
    echo "tim-web: dry run, wrote $HTML_DIR/config.js and $NGINX_CONF" >&2
    exit 0
fi

exec nginx -g 'daemon off;'
