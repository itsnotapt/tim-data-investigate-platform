#!/bin/sh
# TIM web container entrypoint: validate env, render /config.js and the nginx conf, exec nginx.
# See web/README.md for the environment variables.
#
# All runtime output goes to TIM_RUNTIME_DIR, so the root filesystem can be read-only. The image
# serves /config.js from /tmp/tim/config.js and includes /tmp/tim/nginx.conf from
# /etc/nginx/conf.d/default.conf; those paths are fixed, so changing TIM_RUNTIME_DIR is only
# useful for tests that do not start nginx.
#
# Test/override hooks (all optional):
#   TIM_RUNTIME_DIR      where config.js and nginx.conf are written (default /tmp/tim)
#   TIM_NGINX_TEMPLATE   nginx conf template               (default /opt/tim/nginx.conf.template)
#   TIM_ENTRYPOINT_DRY_RUN=1   render files, then exit 0 instead of exec'ing nginx
set -eu

RUNTIME_DIR=${TIM_RUNTIME_DIR:-/tmp/tim}
NGINX_TEMPLATE=${TIM_NGINX_TEMPLATE:-/opt/tim/nginx.conf.template}
NGINX_CONF="$RUNTIME_DIR/nginx.conf"

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
# Scheme + host[:port] only. A path would change how nginx forwards /api/.
printf '%s' "$BACKEND_URI" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
    || fail "BACKEND_URI must be http(s)://host[:port] with no path (got '$BACKEND_URI')"
is_http_url "$REDIRECT_URI" || fail "REDIRECT_URI must be an http(s) URL"
is_http_url "$TAG_CLUSTER" || fail "TAG_CLUSTER must be an http(s) URL"
printf '%s' "$AUTH_TENANT_ID" | grep -Eq '^[A-Za-z0-9.-]+$' \
    || fail "AUTH_TENANT_ID must be a tenant GUID or domain name"

TAG_DATABASE=${TAG_DATABASE:-Research}
API_BASEPATH=${API_BASEPATH-}
# Optional: without a key AG Grid Enterprise runs in trial mode.
AGGRID_LICENSE=${AGGRID_LICENSE-}
if [ -z "$AGGRID_LICENSE" ]; then
    echo "tim-web: AGGRID_LICENSE not set, AG Grid Enterprise runs in trial mode" >&2
fi
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
# apply, except agGridLicenseKey, which is always written (empty = trial mode).
mkdir -p "$RUNTIME_DIR"
config_tmp="$RUNTIME_DIR/.config.js.$$"
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
        } | with_entries(select(.value != "" or .key == "agGridLicenseKey"))' \
        | sed 's/</\\u003c/g'
    printf ';\n'
} >"$config_tmp"
mv "$config_tmp" "$RUNTIME_DIR/config.js"

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

# CSP connect-src: a cross-origin API_BASEPATH (scheme://host[:port]) must be allowed explicitly.
# A same-origin path (or empty) needs nothing. Anything else is refused rather than injected into
# the header.
CSP_CONNECT_EXTRA=""
case "$API_BASEPATH" in
    http://* | https://*)
        api_origin=$(printf '%s' "$API_BASEPATH" | sed -E 's|^(https?://[^/?#]+).*$|\1|')
        printf '%s' "$api_origin" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
            || fail "API_BASEPATH must be empty, a path, or http(s)://host[:port][/path] (got '$API_BASEPATH')"
        CSP_CONNECT_EXTRA=" $api_origin"
        ;;
esac

# All substituted values were validated above, so they are safe for sed and for nginx.
sed -e "s|@BACKEND_URI@|$BACKEND_URI|g" -e "s|@NGINX_RESOLVER@|$NGINX_RESOLVER|g" \
    -e "s|@CSP_CONNECT_EXTRA@|$CSP_CONNECT_EXTRA|g" \
    "$NGINX_TEMPLATE" >"$NGINX_CONF"

if [ "${TIM_ENTRYPOINT_DRY_RUN:-}" = 1 ]; then
    echo "tim-web: dry run, wrote $RUNTIME_DIR/config.js and $NGINX_CONF" >&2
    exit 0
fi

exec nginx -g 'daemon off;'
