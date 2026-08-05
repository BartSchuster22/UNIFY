#!/bin/sh
set -eu
: "${HERMES_API_KEY_FILE:?HERMES_API_KEY_FILE is required}"
API_SERVER_KEY=$(cat "$HERMES_API_KEY_FILE")
export API_SERVER_KEY
exec hermes gateway run
