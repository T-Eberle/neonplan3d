# Dev container: Python for Home Assistant and the integration's checks, Node for the frontend.
# The Home Assistant version follows the production installation, so a copied .storage loads as it does there.
FROM mcr.microsoft.com/devcontainers/python:3.14

ARG HA_VERSION=2026.10.1
ARG NODE_MAJOR=24

# Node (the frontend build and its tests) and the few system libraries Home Assistant's core wants
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs ffmpeg libturbojpeg0 libpcap0.8 \
    && rm -rf /var/lib/apt/lists/*

# Home Assistant and the checks (pytest, ruff, mypy) go into the image's own Python; the vscode user can write to
# it, because Home Assistant installs the requirements of integrations at runtime
COPY requirements_test.txt /tmp/requirements_test.txt
RUN pip install --no-cache-dir --upgrade pip uv \
    && uv pip install --system --no-cache "homeassistant==${HA_VERSION}" -r /tmp/requirements_test.txt ruff mypy \
    && chown -R vscode:vscode "$(python -c 'import sysconfig; print(sysconfig.get_path("purelib"))')" /usr/local/bin
