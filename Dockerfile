# # syntax=docker/dockerfile:1.7

# # ============================================================================
# # Stage 1: langgraph dev (local/dev runtime)
# #
# # Deliberately NOT langchain/langgraph-api (that image needs a LangSmith API
# # key or a paid LANGGRAPH_CLOUD_LICENSE_KEY for anything beyond a quick local
# # test — see README.md "Why langgraph dev, not the official image"). This
# # runs the free, open-source `langgraph dev` server: no keys, no license.
# #
# # Build it explicitly with:  docker build --target langgraph-dev -t app:dev .
# # (The default final stage is `aegra` below, so this stage is only used when
# # you name it.)
# # ============================================================================
# FROM python:3.12-slim AS langgraph-dev

# WORKDIR /app

# RUN apt-get update && apt-get install -y --no-install-recommends curl \
#     && rm -rf /var/lib/apt/lists/*

# # Install uv (small, pinned image; cached layer)
# COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# ENV UV_COMPILE_BYTECODE=1 \
#     UV_LINK_MODE=copy \
#     UV_PYTHON_DOWNLOADS=never \
#     UV_PROJECT_ENVIRONMENT=/app/.venv \
#     UV_HTTP_TIMEOUT=120 \
#     UV_HTTP_RETRIES=10

# # --- Dependency layer (cached; busts only when pyproject.toml/uv.lock change) ---
# # NOTE: commit uv.lock to your repo — the build requires it. Generate it once
# # with `uv lock` if you haven't already.
# COPY pyproject.toml uv.lock ./
# RUN --mount=type=cache,target=/root/.cache/uv \
#     uv sync --frozen --no-dev --no-install-project

# # --- Project layer ---
# COPY . .
# RUN --mount=type=cache,target=/root/.cache/uv \
#     uv sync --frozen --no-dev

# ENV PATH="/app/.venv/bin:$PATH" \
#     PYTHONPATH=/app

# EXPOSE 8123

# # --no-reload overrides hot-reload for a container context (file-watching
# # inside Docker is flaky across bind mounts on some hosts). Drop it if you
# # bind-mount the source for local hot-reload during development.
# CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "8123", "--no-browser"]




FROM python:3.12-slim
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY src ./src
COPY aegra.json langgraph.json ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"