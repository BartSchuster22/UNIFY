#!/command/with-contenv sh
set -eu
source=/run/secrets/hermes-api-token
target=/var/run/s6/container_environment/API_SERVER_KEY
[ -s "$source" ] || { echo "Hermes API token secret is missing" >&2; exit 1; }
install -m 0600 "$source" "$target"
