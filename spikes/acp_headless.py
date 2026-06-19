"""Phase 0 spike — prove the real Hermes `leonardo` agent runs HEADLESS over ACP.

Throwaway. No gateway changes. Uses the agent's own `acp` SDK as the CLIENT,
spawns `hermes --profile leonardo acp`, denies ALL permissions (read-only), and
sends one prompt. If it streams a reply with stop_reason=end_turn, headless works
on the codex rail and the full build is green-lit.

Run:
  /home/exor/.hermes/hermes-agent/venv/bin/python spikes/acp_headless.py
"""
import asyncio
import os
import sys
from typing import Any

HERMES = "/home/exor/.hermes/hermes-agent"
sys.path.insert(0, HERMES)

import acp  # noqa: E402
from acp.schema import (  # noqa: E402
    ClientCapabilities,
    DeniedOutcome,
    Implementation,
    RequestPermissionResponse,
    TextContentBlock,
)

SANDBOX = "/tmp/leo-web-sandbox"


class DenyAllClient:
    """Read-only ACP client: denies every permission, refuses every fs/terminal
    op the agent might ask the client to perform, and prints streamed text."""

    def __init__(self) -> None:
        self.text: list[str] = []
        self.denied: list[str] = []

    async def request_permission(self, options, session_id, tool_call, **kw) -> RequestPermissionResponse:
        name = getattr(tool_call, "title", None) or getattr(tool_call, "tool_name", "?")
        self.denied.append(str(name))
        print(f"  [permission DENIED → {name}]", file=sys.stderr)
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def session_update(self, session_id, update, **kw) -> None:
        su = getattr(update, "session_update", None)
        if su == "agent_message_chunk":
            content = getattr(update, "content", None)
            txt = getattr(content, "text", None)
            if txt:
                self.text.append(txt)
                print(txt, end="", flush=True)
        elif su in ("tool_call_start", "tool_call"):
            print(f"\n  [tool_call: {getattr(update,'title',None) or getattr(update,'tool_name','?')}]", file=sys.stderr)

    # Everything below is the agent asking the CLIENT to act — refuse for read-only.
    async def write_text_file(self, *a, **k):
        raise acp.RequestError(code=-32603, message="read-only: writes denied")

    async def read_text_file(self, *a, **k):
        raise acp.RequestError(code=-32603, message="read-only: file reads denied")

    async def create_terminal(self, *a, **k):
        raise acp.RequestError(code=-32603, message="read-only: terminal denied")

    async def terminal_output(self, *a, **k):
        raise acp.RequestError(code=-32603, message="read-only")

    async def release_terminal(self, *a, **k):
        return None

    async def wait_for_terminal_exit(self, *a, **k):
        raise acp.RequestError(code=-32603, message="read-only")

    async def kill_terminal(self, *a, **k):
        return None


async def main() -> int:
    os.makedirs(SANDBOX, exist_ok=True)
    client = DenyAllClient()
    env = dict(os.environ)

    print("=== spawning hermes --profile leonardo acp ===", file=sys.stderr)
    async with acp.spawn_agent_process(
        client,
        f"{HERMES}/venv/bin/python",
        "-m", "hermes_cli.main", "--profile", "leonardo", "acp",
        env=env,
        cwd=SANDBOX,
    ) as (conn, proc):
        # 1) initialize
        init = await asyncio.wait_for(
            conn.initialize(
                protocol_version=acp.PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(),
                client_info=Implementation(name="leo-web-spike", version="0"),
            ),
            timeout=60,
        )
        print(f"\n[initialize OK] agent_capabilities present="
              f"{getattr(init,'agent_capabilities',None) is not None} "
              f"auth_methods={[getattr(m,'id',m) for m in (getattr(init,'auth_methods',[]) or [])]}",
              file=sys.stderr)

        # 2) new session in the sandbox (no MCP yet)
        ns = await asyncio.wait_for(conn.new_session(cwd=SANDBOX, mcp_servers=[]), timeout=120)
        sid = ns.session_id
        print(f"[session/new OK] session_id={sid}", file=sys.stderr)

        # 3) one prompt — pure reasoning, no tools needed
        print("\n--- PROMPT: who are you? ---\n", file=sys.stderr)
        resp = await asyncio.wait_for(
            conn.prompt(
                prompt=[TextContentBlock(type="text", text="Reply in ONE sentence: who are you?")],
                session_id=sid,
            ),
            timeout=180,
        )
        print(f"\n\n[prompt DONE] stop_reason={getattr(resp,'stop_reason',None)} "
              f"text_chars={sum(len(t) for t in client.text)} "
              f"denied={client.denied}", file=sys.stderr)

        ok = bool(client.text) and getattr(resp, "stop_reason", None) in ("end_turn", "stop", None)
        print(f"\n=== SPIKE {'PASS ✅' if ok else 'FAIL ❌'} (headless reply streamed) ===", file=sys.stderr)
        try:
            proc.terminate()
        except Exception:
            pass
        return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as e:  # noqa: BLE001
        print(f"\n=== SPIKE ERROR: {type(e).__name__}: {e} ===", file=sys.stderr)
        sys.exit(2)
