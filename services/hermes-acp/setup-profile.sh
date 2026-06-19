#!/usr/bin/env bash
# Create/refresh the `leonardo-web` Hermes profile: a read-only sibling of the
# live `leonardo` profile (same SOUL/voice + codex auth) used by the web chat's
# ACP backend. Idempotent. Does NOT touch the live `leonardo` profile.
#
# The read-only guarantee comes from services/hermes-acp/launch.py (toolset
# whitelist), not from this profile's config — but we still point cwd at a
# sandbox and carry the codex credential so the agent runs headless.
set -euo pipefail

HERMES_VENV_PY="${HERMES_VENV_PY:-/home/exor/.hermes/hermes-agent/venv/bin/python}"
PROFILES="${HERMES_PROFILES:-/home/exor/.hermes/profiles}"
SRC="$PROFILES/leonardo"
DST="$PROFILES/leonardo-web"

[[ -d "$SRC" ]] || { echo "ERROR: source profile $SRC not found" >&2; exit 1; }
mkdir -p "$DST" /tmp/leo-web-sandbox

cp "$SRC/config.yaml" "$DST/config.yaml"
cp "$SRC/auth.json" "$DST/auth.json"           # codex credential (headless)
cp "$SRC/.env" "$DST/.env"
ln -sf ../leonardo/SOUL.md "$DST/SOUL.md"       # same voice

# Restrict toolsets at the config level too (defense-in-depth behind launch.py)
# and sandbox the default cwd.
"$HERMES_VENV_PY" - "$DST/config.yaml" <<'PY'
import sys, yaml
p = sys.argv[1]
cfg = yaml.safe_load(open(p))
cfg.setdefault("agent", {})["disabled_toolsets"] = ["terminal", "file", "messaging", "cronjob", "browser"]
cfg.setdefault("model", {})["default"] = "gpt-5.4-mini"   # faster than the live profile's gpt-5.5
# Web chat must feel snappy. The live Leonardo runs reasoning_effort=xhigh, which on
# a tool-heavy graph question can mean 19 tool calls + minutes of latency. Medium
# keeps the reasoning useful while staying responsive.
cfg["agent"]["reasoning_effort"] = "medium"
cfg.setdefault("terminal", {})["cwd"] = "/tmp/leo-web-sandbox"
cfg.setdefault("terminal", {})["backend"] = "local"
# CROSS-CONVERSATION ISOLATION: kill the builtin persistent memory. It writes a
# profile-GLOBAL memories/USER.md and injects it into EVERY new session's prompt,
# independent of the toolset whitelist — so one visitor's chat would leak into the
# next. Each web conversation must stay confined to its own ACP session history.
mem = cfg.setdefault("memory", {})
mem["memory_enabled"] = False
mem["user_profile_enabled"] = False
# Guardrail injected into the system prompt: consult council memory, never convene.
cfg["agent"]["environment_hint"] = (
  "PLATFORM CONTEXT — Leonardo public web chat (read-only). Your tools are exactly: "
  "the imagination-graph reads (search_graph, graph_concept, graph_related, graph_bible) "
  "and council_memory. You have NO shell, NO filesystem, NO messaging. "
  "On the Council: you may ONLY CONSULT council_memory to recall what the Council has "
  "already ruled. You CANNOT convene, run, or commission the Council here — there is no "
  "council review or panel tool on this interface, and you must not claim to start one or "
  "promise a fresh deliberation. If a visitor wants a new Council review, recall the closest "
  "prior ruling with council_memory and tell them a fresh panel must be requested elsewhere."
)
yaml.safe_dump(cfg, open(p, "w"), sort_keys=False, default_flow_style=False)
print("leonardo-web: disabled_toolsets =", cfg["agent"]["disabled_toolsets"])
PY

echo "leonardo-web profile ready at $DST"
