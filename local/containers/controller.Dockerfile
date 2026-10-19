FROM node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0
ARG NPM_REGISTRY
COPY package.json package-lock.json /opt/lights-on-cli/
ENV LIGHTS_ON_COPILOT_SDK_DIR=/opt/lights-on-cli
RUN test -n "$NPM_REGISTRY" && \
    cd /opt/lights-on-cli && \
    npm ci --ignore-scripts --omit=dev --no-audit --no-fund --registry="$NPM_REGISTRY" && \
    ln -s /opt/lights-on-cli/node_modules/.bin/copilot /usr/local/bin/copilot && \
    npm cache clean --force
