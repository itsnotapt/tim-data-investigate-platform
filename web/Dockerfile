# syntax=docker/dockerfile:1
# TIM web image. Build context: web/  (docker build -t tim-web web/)

FROM node:24-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build


FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime

USER root
RUN apk add --no-cache jq \
 && mkdir -p /opt/tim \
 && printf '%s\n' 'include /tmp/tim/nginx.conf;' >/etc/nginx/conf.d/default.conf \
 && chown root:root /etc/nginx/conf.d /etc/nginx/conf.d/default.conf \
 && chmod 0755 /etc/nginx/conf.d \
 && chmod 0644 /etc/nginx/conf.d/default.conf

COPY docker/nginx.conf.template /opt/tim/nginx.conf.template
COPY --chmod=0755 docker/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=build /app/dist /usr/share/nginx/html

# The root filesystem is read-only at runtime. The entrypoint writes config.js and the rendered
# nginx conf to /tmp/tim; nginx's pid and temp paths are in /tmp. conf.d/default.conf includes
# /tmp/tim/nginx.conf.
# Runtime env: see web/README.md. Required: BACKEND_URI, REDIRECT_URI, AUTH_CLIENT_ID,
# AUTH_TENANT_ID, TAG_CLUSTER. AGGRID_LICENSE is optional (empty = AG Grid trial).
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
