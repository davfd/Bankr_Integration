"""Long-lived bridge: gateway <-> read-only Hermes ACP agent (the web Leonardo).

The gateway owns ONE of these. It keeps a single read-only ACP agent process
alive, maps each web conversation to a persistent ACP session (so Hermes retains
its own history + does its own compaction), denies every tool-permission request,
and exposes the imagination graph + council memory via the read-only MCP.

Line protocol (one JSON object per line):
  stdin   {"op":"prompt","cid":"<conversation id>","text":"<user message>"}
          {"op":"ping"}
  stdout  {"f":"text","d":"..."}        streamed assistant text
          {"f":"tool","n":"<name>"}     a tool call started
          {"f":"usage","in":N,"out":N}  token usage for the turn
          {"f":"done"}                  turn complete
          {"f":"err","m":"..."}         turn-level error (loop continues)
          {"f":"ready"}                 emitted once after init
All logging goes to stderr; stdout is the protocol channel only.

Run with the hermes venv:
  /home/exor/.hermes/hermes-agent/venv/bin/python services/hermes-acp/bridge.py
Env: LEO_WEB_PROFILE (default leonardo-web), WORKSHOP_SIDECAR_URL, COUNCIL_MEMORY_LOG.
"""
import asyncio
import json
import os
import secrets
import sys

HERMES = "/home/exor/.hermes/hermes-agent"
# bridge.py lives at <repo>/services/hermes-acp/bridge.py → three dirnames to repo root.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, HERMES)

import acp  # noqa: E402
from acp.schema import (  # noqa: E402
    ClientCapabilities,
    DeniedOutcome,
    EnvVariable,
    Implementation,
    McpServerStdio,
    RequestPermissionResponse,
    TextContentBlock,
)

PROFILE = os.environ.get("LEO_WEB_PROFILE", "leonardo-web")
SANDBOX = os.environ.get("LEO_WEB_SANDBOX", "/tmp/leo-web-sandbox")
PY = f"{HERMES}/venv/bin/python"
LAUNCHER = f"{REPO}/services/hermes-acp/launch.py"
SIDECAR = os.environ.get("WORKSHOP_SIDECAR_URL", "http://127.0.0.1:8799")
COUNCIL_LOG = os.environ.get("COUNCIL_MEMORY_LOG", os.path.expanduser("~/.leonardo-platform/council-memory/log.json"))
GUARD_EVENTS = os.environ.get("LEO_WEB_TOOL_GUARD_EVENTS", f"/tmp/leo-web-identity-tool-guard-events-{os.getpid()}-{secrets.token_hex(8)}.jsonl")
GUARD_CONTEXT = os.environ.get("LEO_WEB_TOOL_GUARD_CONTEXT", f"/tmp/leo-web-identity-tool-guard-context-{os.getpid()}-{secrets.token_hex(8)}.json")

_out_lock = asyncio.Lock()


def guard_event_offset() -> int:
    try:
        return os.path.getsize(GUARD_EVENTS)
    except FileNotFoundError:
        return 0
    except OSError:
        return 0


def write_guard_context(request_id: str) -> None:
    try:
        parent = os.path.dirname(GUARD_CONTEXT)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = f"{GUARD_CONTEXT}.tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"request_id": request_id}, fh, ensure_ascii=False)
        os.replace(tmp, GUARD_CONTEXT)
    except OSError as exc:
        log("guard context write failed:", type(exc).__name__)


def guard_events_since(offset: int, request_id: str) -> list[str]:
    try:
        with open(GUARD_EVENTS, "r", encoding="utf-8") as fh:
            fh.seek(offset)
            out: list[str] = []
            for line in fh:
                try:
                    event = json.loads(line)
                except Exception:
                    continue
                if event.get("request_id") != request_id:
                    continue
                if event.get("event") == "blocked_tool" and isinstance(event.get("tool_name"), str):
                    out.append(event["tool_name"])
            return out
    except FileNotFoundError:
        return []
    except OSError:
        return []


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(*a) -> None:
    print("[bridge]", *a, file=sys.stderr, flush=True)


class StreamingClient:
    """Read-only ACP client: streams text/tool frames, denies every permission,
    refuses every fs/terminal op (defense-in-depth behind the toolset whitelist)."""

    async def request_permission(self, options, session_id, tool_call, **kw):
        name = getattr(tool_call, "title", None) or getattr(tool_call, "tool_name", "?")
        log("permission DENIED ->", name)
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def session_update(self, session_id, update, **kw):
        su = getattr(update, "session_update", None)
        if su == "agent_message_chunk":
            t = getattr(getattr(update, "content", None), "text", None)
            if t:
                emit({"f": "text", "d": t})
        elif su in ("tool_call_start", "tool_call"):
            nm = getattr(update, "title", None) or getattr(update, "tool_name", "?")
            emit({"f": "tool", "n": str(nm)})

    async def write_text_file(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def read_text_file(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def create_terminal(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def terminal_output(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def release_terminal(self, *a, **k): return None
    async def wait_for_terminal_exit(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def kill_terminal(self, *a, **k): return None


def graph_mcp() -> McpServerStdio:
    return McpServerStdio(
        name="leonardo-graph",
        command=PY,
        args=[f"{REPO}/services/graph-mcp/server.py"],
        env=[
            EnvVariable(name="WORKSHOP_SIDECAR_URL", value=SIDECAR),
            EnvVariable(name="COUNCIL_MEMORY_LOG", value=COUNCIL_LOG),
        ],
    )


async def main() -> int:
    os.makedirs(SANDBOX, exist_ok=True)
    client = StreamingClient()
    sessions: dict[str, str] = {}  # conversation id -> ACP session id

    log(f"spawning read-only ACP agent (profile={PROFILE})")
    async with acp.spawn_agent_process(
        client, PY, LAUNCHER, "--profile", PROFILE, "acp",
        env={**os.environ, "LEO_WEB_TOOL_GUARD_EVENTS": GUARD_EVENTS, "LEO_WEB_TOOL_GUARD_CONTEXT": GUARD_CONTEXT}, cwd=SANDBOX,
        # Inherit the agent's stderr → our stderr. The default is an unread PIPE
        # that fills (~64KB) under Hermes' verbose logging and blocks the agent
        # mid-handshake. Inheriting drains it naturally.
        transport_kwargs={"stderr": None},
    ) as (conn, proc):
        await asyncio.wait_for(conn.initialize(
            protocol_version=acp.PROTOCOL_VERSION,
            client_capabilities=ClientCapabilities(),
            client_info=Implementation(name="leo-web-bridge", version="1"),
        ), timeout=180)
        log("initialized")
        emit({"f": "ready"})

        loop = asyncio.get_event_loop()

        async def ensure_session(cid: str) -> tuple[str, bool]:
            """Return (session_id, is_new). is_new=True only when we just opened it."""
            sid = sessions.get(cid)
            if sid:
                return sid, False
            ns = await asyncio.wait_for(conn.new_session(cwd=SANDBOX, mcp_servers=[graph_mcp()]), timeout=120)
            sessions[cid] = ns.session_id
            log(f"new session cid={cid[:8]} -> {ns.session_id[:8]}")
            return ns.session_id, True

        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                log("stdin closed; exiting")
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                emit({"f": "err", "m": "bad json"})
                continue

            op = msg.get("op")
            if op == "ping":
                emit({"f": "pong"})
                continue
            if op != "prompt":
                emit({"f": "err", "m": f"unknown op {op}"})
                continue

            cid = str(msg.get("cid") or "default")
            text = str(msg.get("text") or "").strip()
            preamble = str(msg.get("preamble") or "").strip()
            if not text:
                emit({"f": "err", "m": "empty text"}); emit({"f": "done"}); continue

            try:
                sid, is_new = await ensure_session(cid)
                # Inject member context once, on the session's first turn — it then
                # rides the ACP session history for the rest of the conversation.
                prompt_text = f"{preamble}\n\n{text}" if (is_new and preamble) else text
                request_id = secrets.token_hex(16)
                guard_offset = guard_event_offset()
                write_guard_context(request_id)
                resp = await asyncio.wait_for(
                    conn.prompt(prompt=[TextContentBlock(type="text", text=prompt_text)], session_id=sid),
                    timeout=300,
                )
                for blocked_tool in guard_events_since(guard_offset, request_id):
                    emit({"f": "tool", "n": blocked_tool})
                usage = getattr(resp, "usage", None)
                if usage is not None:
                    emit({"f": "usage",
                          "in": int(getattr(usage, "input_tokens", 0) or 0),
                          "out": int(getattr(usage, "output_tokens", 0) or 0)})
                emit({"f": "done", "stop": getattr(resp, "stop_reason", None)})
            except Exception as e:  # turn-level failure must not kill the bridge
                log("turn error:", type(e).__name__, str(e)[:200])
                emit({"f": "err", "m": f"{type(e).__name__}"})
                emit({"f": "done"})

        try:
            proc.terminate()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as e:
        log("FATAL:", type(e).__name__, str(e))
        sys.exit(2)
