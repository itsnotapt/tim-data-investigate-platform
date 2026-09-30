# syntax=docker/dockerfile:1
# TIM web image. Build context: web/  (docker build -t tim-web web/)

FROM node:24-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build


FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

USER root
RUN apk add --no-cache jq \
 && rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /opt/tim \
 && chown -R 101:0 /etc/nginx/conf.d /usr/share/nginx/html

COPY docker/nginx.conf.template /opt/tim/nginx.conf.template
COPY --chmod=0755 docker/docker-entrypoint.sh /docker-entrypoint.sh
COPY --from=build --chown=101:0 /app/dist /usr/share/nginx/html

# Runtime env: see web/README.md. Required: BACKEND_URI, REDIRECT_URI, AUTH_CLIENT_ID,
# AUTH_TENANT_ID, TAG_CLUSTER, and AGGRID_LICENSE unless TIM_ENVIRONMENT=development.
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
