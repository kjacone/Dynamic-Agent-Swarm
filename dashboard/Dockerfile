# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# Where the BROWSER reaches the admin API (api.ts reads VITE_API_BASE).
ARG VITE_API_BASE=http://localhost:8000
ENV VITE_API_BASE=$VITE_API_BASE

# `vite build` only (no `tsc`): shadcn components whose packages are missing
# from package.json are never imported, so they can't break the bundle.
RUN npx vite build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80