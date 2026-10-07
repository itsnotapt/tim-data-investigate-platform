{{/* Chart name. */}}
{{- define "tim.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Release-qualified name, max 63 characters (DNS label). Component suffixes are added to a
prefix truncated to 52 characters. */}}
{{- define "tim.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 52 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 52 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 52 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "tim.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Common labels. */}}
{{- define "tim.labels" -}}
helm.sh/chart: {{ include "tim.chart" . }}
app.kubernetes.io/name: {{ include "tim.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: tim
{{- end }}

{{/* Selector labels for one component. Usage: include "tim.selectorLabels" (list . "api") */}}
{{- define "tim.selectorLabels" -}}
{{- $ := index . 0 -}}
app.kubernetes.io/name: {{ include "tim.name" $ }}
app.kubernetes.io/instance: {{ $.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{/* Labels for one component. Usage: include "tim.componentLabels" (list . "api") */}}
{{- define "tim.componentLabels" -}}
{{ include "tim.labels" (index . 0) }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{- define "tim.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "tim.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Image reference. Usage: include "tim.image" (list . .Values.api.image "backend")
The digest wins over the tag; an empty tag uses the version pinned for the component
("frontend" or "backend") in image-tags.yaml, which release-please updates. */}}
{{- define "tim.image" -}}
{{- $ := index . 0 -}}
{{- $img := index . 1 -}}
{{- $component := index . 2 -}}
{{- if $img.digest -}}
{{- printf "%s@%s" $img.repository $img.digest -}}
{{- else -}}
{{- $pinned := index ($.Files.Get "image-tags.yaml" | fromYaml) $component | toString -}}
{{- printf "%s:%s" $img.repository (default $pinned ($img.tag | toString)) -}}
{{- end -}}
{{- end }}

{{- define "tim.secretName" -}}
{{- default (include "tim.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{- define "tim.apiServiceName" -}}
{{- printf "%s-api" (include "tim.fullname" .) }}
{{- end }}

{{- define "tim.webServiceName" -}}
{{- printf "%s-web" (include "tim.fullname" .) }}
{{- end }}

{{- define "tim.postgresqlServiceName" -}}
{{- printf "%s-postgresql" (include "tim.fullname" .) }}
{{- end }}

{{/* Public origin: config.publicUrl, else https://<ingress.host>. */}}
{{- define "tim.publicUrl" -}}
{{- if .Values.config.publicUrl }}
{{- .Values.config.publicUrl | trimSuffix "/" }}
{{- else if and .Values.ingress.enabled .Values.ingress.host }}
{{- printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.ingress.host }}
{{- else }}
{{- fail "set config.publicUrl (or ingress.enabled with ingress.host)" }}
{{- end }}
{{- end }}

{{/* Required-value checks, rendered once from the api ConfigMap. */}}
{{- define "tim.validate" -}}
{{- $_ := required "config.auth.tenantId is required" .Values.config.auth.tenantId }}
{{- $_ := required "config.auth.clientId is required" .Values.config.auth.clientId }}
{{- $_ := required "config.tags.clusterUri is required" .Values.config.tags.clusterUri }}
{{- if not (hasPrefix "https://" .Values.config.tags.clusterUri) }}
{{- fail "config.tags.clusterUri must be an https URL" }}
{{- end }}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) }}
{{- fail "ingress.host is required when ingress.enabled" }}
{{- end }}
{{- $workloadIdentity := eq (toString (index .Values.api.podLabels "azure.workload.identity/use")) "true" }}
{{- if and (eq .Values.config.environment "production") (not .Values.secrets.existingSecret) (not .Values.secrets.authClientSecret) (not $workloadIdentity) }}
{{- fail "the api needs an OBO credential: set secrets.authClientSecret, secrets.existingSecret (key TIM_AUTH_CLIENT_SECRET), or Entra workload identity (api.podLabels azure.workload.identity/use: \"true\" plus serviceAccount.annotations azure.workload.identity/client-id)" }}
{{- end }}
{{- if not .Values.secrets.existingSecret }}
{{- if .Values.postgresql.enabled }}
{{- $_ := required "postgresql.auth.password is required when postgresql.enabled (or set secrets.existingSecret)" .Values.postgresql.auth.password }}
{{- else }}
{{- $_ := required "secrets.databaseUrl is required (or set secrets.existingSecret, or postgresql.enabled)" .Values.secrets.databaseUrl }}
{{- end }}
{{- end }}
{{- end }}

{{/* TIM_DATABASE_URL built for the in-cluster PostgreSQL. */}}
{{- define "tim.postgresqlDatabaseUrl" -}}
{{- $pg := .Values.postgresql.auth -}}
{{- printf "postgresql+asyncpg://%s:%s@%s:5432/%s" $pg.username $pg.password (include "tim.postgresqlServiceName" .) $pg.database -}}
{{- end }}

{{/* Secret-backed environment shared by the api Deployment and the migrations Job. */}}
{{- define "tim.databaseUrlEnv" -}}
- name: TIM_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "tim.secretName" . }}
      key: TIM_DATABASE_URL
{{- end }}
