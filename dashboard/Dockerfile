# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build

# Local dependency (must be a sibling of /app to match file:../agent-kit)
WORKDIR /agent-kit
COPY agent-kit/ ./
# Only if agent-kit needs compiling (see note below):
RUN npm install && npm run build

WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json* ./
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm ci
COPY dashboard/ .
RUN npx vite build

FROM nginx:alpine
COPY dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html