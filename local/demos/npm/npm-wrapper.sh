#!/bin/sh
set -eu
if [ ! -d /tmp/lights-on-npm-cache ]; then
  cp -R /opt/lights-on-npm-cache /tmp/lights-on-npm-cache
fi
export npm_config_cache=/tmp/lights-on-npm-cache
export npm_config_offline=true
if [ "${1-}" = ci ] && [ -f /opt/lights-on-npm-inputs/package-lock.json ] && [ ! -e package-lock.json ]; then
  exec node /opt/lights-on-npm-install.mjs "$@"
fi
exec node /usr/local/lib/node_modules/npm/bin/npm-cli.js "$@"
