{{- define "nmb.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nmb.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "nmb.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nmb.labels" -}}
helm.sh/chart: {{ include "nmb.chart" . }}
{{ include "nmb.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "nmb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "nmb.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "nmb.componentName" -}}
{{- printf "%s-%s" (include "nmb.fullname" .root) .component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nmb.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "nmb.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "nmb.configMapName" -}}
{{- printf "%s-config" (include "nmb.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nmb.dataClaimName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "nmb.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "nmb.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "nmb.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "nmb.langgraphUrl" -}}
{{- if .Values.config.langgraphUrl }}
{{- .Values.config.langgraphUrl }}
{{- else }}
{{- printf "http://%s:%v" (include "nmb.componentName" (dict "root" . "component" "aegra")) .Values.aegra.port }}
{{- end }}
{{- end }}

{{- define "nmb.image" -}}
{{- printf "%s:%s" .image.repository (.image.tag | default .root.Chart.AppVersion) }}
{{- end }}
