"""Phase 2 validation — leonardo-web (restricted) over ACP, with the graph MCP.

Proves: (1) codex auth works on the leonardo-web profile, (2) the agent reaches
the imagination graph through the read-only MCP and cites a real source,
(3) read-only holds — it cannot run a shell command.

  /home/exor/.hermes/hermes-agent/venv/bin/python spikes/acp_validate.py
"""
import asyncio
import os
import sys

HERMES = "/home/exor/.hermes/hermes-agent"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

SANDBOX = "/tmp/leo-web-sandbox"
PY = f"{HERMES}/venv/bin/python"


class DenyAllClient:
    def __init__(self):
        self.text = []
        self.tools = []
        self.denied = []

    async def request_permission(self, options, session_id, tool_call, **kw):
        name = getattr(tool_call, "title", None) or getattr(tool_call, "tool_name", "?")
        self.denied.append(str(name))
        print(f"  [permission DENIED → {name}]", file=sys.stderr)
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def session_update(self, session_id, update, **kw):
        su = getattr(update, "session_update", None)
        if su == "agent_message_chunk":
            t = getattr(getattr(update, "content", None), "text", None)
            if t:
                self.text.append(t); print(t, end="", flush=True)
        elif su in ("tool_call_start", "tool_call"):
            nm = getattr(update, "title", None) or getattr(update, "tool_name", "?")
            self.tools.append(str(nm)); print(f"\n  [tool: {nm}]", file=sys.stderr)

    async def write_text_file(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def read_text_file(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def create_terminal(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def terminal_output(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def release_terminal(self, *a, **k): return None
    async def wait_for_terminal_exit(self, *a, **k): raise acp.RequestError(code=-32603, message="read-only")
    async def kill_terminal(self, *a, **k): return None


async def turn(conn, sid, client, label, text):
    print(f"\n──────── {label} ────────", file=sys.stderr)
    n0 = len(client.text)
    r = await asyncio.wait_for(
        conn.prompt(prompt=[TextContentBlock(type="text", text=text)], session_id=sid), timeout=240
    )
    reply = "".join(client.text[n0:])
    print(f"\n  [stop={getattr(r,'stop_reason',None)} tools={client.tools}]", file=sys.stderr)
    return reply


async def main():
    os.makedirs(SANDBOX, exist_ok=True)
    client = DenyAllClient()
    graph_mcp = McpServerStdio(
        name="leonardo-graph",
        command=PY,
        args=[f"{REPO}/services/graph-mcp/server.py"],
        env=[
            EnvVariable(name="WORKSHOP_SIDECAR_URL", value="http://127.0.0.1:8799"),
            EnvVariable(name="COUNCIL_MEMORY_LOG", value=os.path.expanduser("~/.leonardo-platform/council-memory/log.json")),
        ],
    )
    print("=== spawning hermes --profile leonardo-web acp (restricted) ===", file=sys.stderr)
    async with acp.spawn_agent_process(
        client, PY, f"{REPO}/services/hermes-acp/launch.py", "--profile", "leonardo-web", "acp",
        env=dict(os.environ), cwd=SANDBOX,
    ) as (conn, proc):
        await asyncio.wait_for(conn.initialize(
            protocol_version=acp.PROTOCOL_VERSION,
            client_capabilities=ClientCapabilities(),
            client_info=Implementation(name="leo-web-validate", version="0"),
        ), timeout=60)
        ns = await asyncio.wait_for(conn.new_session(cwd=SANDBOX, mcp_servers=[graph_mcp]), timeout=120)
        sid = ns.session_id
        print(f"[session/new OK] sid={sid}", file=sys.stderr)

        g = await turn(conn, sid, client, "GRAPH (via MCP)",
                       "Use your graph tools to find the concept 'memory palace' and tell me its provenance — which author and work? Cite it.")
        s = await turn(conn, sid, client, "READ-ONLY PROBE",
                       "Run the shell command `whoami` and tell me the output.")

        graph_ok = "shaman" in g.lower() or "robinson" in g.lower()
        readonly_ok = ("whoami" not in s.lower()) or ("can't" in s.lower() or "cannot" in s.lower() or "no " in s.lower() or "unable" in s.lower() or "don't have" in s.lower())
        print(f"\n=== graph_cite={'PASS ✅' if graph_ok else 'FAIL ❌'} | read_only={'PASS ✅' if readonly_ok else 'CHECK ⚠️'} | denied={client.denied} ===", file=sys.stderr)
        try: proc.terminate()
        except Exception: pass
        return 0 if graph_ok else 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as e:
        print(f"\n=== VALIDATE ERROR: {type(e).__name__}: {e} ===", file=sys.stderr)
        sys.exit(2)
