#!/usr/bin/env bash
# End-to-end tour of the REST API: look around a home, then a person opens the door,
# an alert is raised and the light switches on.
#
#   scripts/api-walkthrough.sh          pause after each step (press Enter)
#   scripts/api-walkthrough.sh --fast   run without pausing
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

API="http://localhost:${API_PORT:-4000}"
HOME_ID=H001
FAST=${1:-}

bold=$'\e[1m'; teal=$'\e[36m'; dim=$'\e[2m'; reset=$'\e[0m'

step() {
  echo
  echo "${bold}${teal}== Step $1: $2${reset}"
  echo "${dim}$3${reset}"
}

# call METHOD PATH [JSON-BODY]: prints the request, then the pretty-printed response
call() {
  local method=$1 path=$2 body=${3:-}
  echo "${bold}> $method $path${reset}"
  [[ -n $body ]] && echo "${dim}  body: $body${reset}"
  local args=(-s -X "$method" -H "x-api-key: $API_KEY" -w '\n%{http_code}')
  [[ -n $body ]] && args+=(-H 'content-type: application/json' -d "$body")
  local out code
  out=$(curl "${args[@]}" "$API$path")
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  echo "< HTTP $code"
  if [[ -n $out ]]; then
    node -e 'const s=require("fs").readFileSync(0,"utf8");try{const t=JSON.stringify(JSON.parse(s),null,2).split("\n");console.log(t.slice(0,25).join("\n")+(t.length>25?"\n  ... ("+(t.length-25)+" more lines)":""))}catch{console.log(s)}' <<<"$out"
  fi
}

pause() { [[ $FAST == --fast ]] || read -rp "${dim}(press Enter for the next step)${reset}"; }

step 0 "Is the system up?" "Public health check: no API key needed. Shows the current main (primary) server."
echo "${bold}> GET /health${reset}"; curl -s "$API/health"; echo
pause

step 1 "Without the key you are refused" "Every /api/v1 call needs the x-api-key header."
echo "${bold}> GET /api/v1/homes   (no key)${reset}"
curl -s -w '\n< HTTP %{http_code}\n' "$API/api/v1/homes"
pause

step 2 "The three database servers" "One PRIMARY saves new data, two SECONDARY servers keep copies."
call GET /api/v1/cluster/status
pause

step 3 "List the homes" "20 homes from the test dataset."
call GET "/api/v1/homes?city=Liverpool"
pause

step 4 "One home with all its devices" "A single query joins the home to its devices (\$lookup)."
call GET "/api/v1/homes/$HOME_ID"
pause

step 5 "The devices in the hallway" "Filter devices by home and room: a door sensor and a light are here."
call GET "/api/v1/devices?homeId=$HOME_ID&room=hallway"
pause

step 6 "A PERSON OPENS THE DOOR" "The door sensor sends 'open' over MQTT: expect an alert and the light switching on."
call POST /api/v1/simulate/door "{\"homeId\":\"$HOME_ID\"}"
pause

step 7 "Room status" "Door closed again, light on, and the door alert listed."
call GET "/api/v1/rooms/$HOME_ID/hallway?limit=2"
pause

step 8 "Door alerts" "Every door-opened alert for this home, newest first."
call GET "/api/v1/alerts?homeId=$HOME_ID&kind=door_opened&limit=3"
pause

step 9 "The stored sensor readings" "The door and light events just saved, newest first."
call GET "/api/v1/events?homeId=$HOME_ID&room=hallway&limit=4"
pause

step 10 "Bad input is rejected" "No homeId or deviceId: the API explains what is wrong."
call GET /api/v1/events
pause

step 11 "Processing the data: predicted routine" "Median wake-up, leave and return times from 28 days of sensor data (home H005)."
call GET /api/v1/analytics/homes/H005/routine

echo
echo "${bold}Done.${reset} Try the same calls in the browser at $API/docs"
