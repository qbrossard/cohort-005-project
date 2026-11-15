#!/usr/bin/env bash
# PROTOTYPE — throwaway. Creates the one Knock workflow the Notification Feed prototype
# triggers: `cadence-notification`, a single in-app feed step that passes the trigger
# data straight through. Safe to re-run; it upserts.
#
#   bash scripts/prototype-knock-workflow.sh
#
# The only human part is `knock login`, which opens a browser to authorise the CLI.
set -euo pipefail
cd "$(dirname "$0")/.."

knock() { npx --yes @knocklabs/cli@1.6.2 "$@"; }

echo "==> Checking the Knock CLI is logged in"
if ! knock whoami >/dev/null 2>&1; then
  echo "    Not logged in. A browser window will open: sign in and authorise the CLI."
  knock login
fi

echo "==> Finding the in-app feed channel's key"
CHANNEL_ID="$(grep '^KNOCK_FEED_CHANNEL_ID=' .env | cut -d= -f2- | tr -d '"'"'"' ')"
CHANNEL_KEY="$(knock channel list --json | CHANNEL_ID="$CHANNEL_ID" node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const found = [];
    (function walk(x) {
      if (Array.isArray(x)) return x.forEach(walk);
      if (x && typeof x === "object") {
        if (x.key && (x.id === process.env.CHANNEL_ID || x.type === "in_app_feed")) found.push(x);
        Object.values(x).forEach(walk);
      }
    })(JSON.parse(s));
    const hit = found.find((c) => c.id === process.env.CHANNEL_ID) ?? found[0];
    if (!hit) { console.error("No in-app feed channel found"); process.exit(1); }
    console.log(hit.key);
  });')"
echo "    $CHANNEL_KEY"

DIR=.knock/workflows/cadence-notification
mkdir -p "$DIR"
cat > "$DIR/workflow.json" <<EOF
{
  "name": "Cadence notification (prototype)",
  "description": "PROTOTYPE: one generic in-app feed step for the Notification Feed prototype. The app renders rows from the trigger data.",
  "steps": [
    {
      "ref": "in_app_feed_1",
      "type": "channel",
      "channel_type": "in_app_feed",
      "channel_key": "$CHANNEL_KEY",
      "name": "Notification Feed",
      "template": {
        "markdown_body": "{{ data.text }}",
        "action_url": "{{ data.url }}"
      }
    }
  ]
}
EOF

echo "==> Pushing the workflow to the Development environment"
(cd .knock/workflows && knock workflow push cadence-notification \
  --environment development --commit -m "Notification Feed prototype workflow")
(cd .knock/workflows && knock workflow activate cadence-notification \
  --environment development --force) || true

echo
echo "Done. Run 'npm run dev', pick a user in the DevUI, and use 'Send me…' in the prototype bar."
