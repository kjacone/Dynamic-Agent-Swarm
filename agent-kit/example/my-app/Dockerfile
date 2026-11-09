# syntax=docker/dockerfile:1.7
FROM node:20-alpine
WORKDIR /app

# 1. Install the library's deps (context is ./agent-kit)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 2. Copy library + example/my-app
COPY . .

# 3. Build the library (tsup) so the example's `file:../..` dep resolves to dist/
RUN npm run build

# 4. Install the example's deps and run dev server from there
WORKDIR /app/example/my-app
RUN npm ci || npm install

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]