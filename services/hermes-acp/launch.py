"""Read-only launcher for the Hermes ACP server (the web-safe Leonardo).

The stock ACP path hardcodes the full-power `hermes-acp` toolset (terminal,
file write, execute_code, browser, delegate_task) and ignores a profile's
`disabled_toolsets`. Hermes' terminal runs SERVER-SIDE, so a client cannot gate
it, and benign commands skip the approval callback entirely. The only reliable
read-only guarantee is to restrict the agent's toolset itself.

This launcher monkeypatches `acp_adapter.session._expand_acp_enabled_toolsets`
to a SAFE WHITELIST before starting the server — so the agent only ever gets
read/reason tools plus whatever read-only MCP servers the client attaches at
`session/new`. The shared Hermes install is NOT modified (update-resilient).

Run exactly like `hermes --profile <p> acp`:
  /home/exor/.hermes/hermes-agent/venv/bin/python services/hermes-acp/launch.py --profile leonardo-web acp
"""
import sys

HERMES = "/home/exor/.hermes/hermes-agent"
if HERMES not in sys.path:
    sys.path.insert(0, HERMES)

# Built-in toolsets the web agent is allowed to have. NO terminal, file, patch,
# execute_code, delegate_task, browser, messaging, cronjob. Graph/council come in
# as a read-only MCP attached per-session by the gateway, added on top of this.
#
# DELIBERATELY EXCLUDED: "memory" and "session_search". Both are read-only to the
# host, but they read/write a PROFILE-GLOBAL store shared across every web
# conversation — so a brand-new chat would recall (and a user could surface)
# another conversation's content. That breaks per-conversation isolation on a
# public, multi-user surface. Per-conversation memory must come ONLY from the ACP
# session's own retained history (one web conversation = one isolated ACP session),
# which the gateway already maps. Keep this list to stateless read/reason tools.
SAFE_TOOLSETS = ["web", "vision"]


def _install_readonly_whitelist() -> None:
    import acp_adapter.session as session

    def _safe_expand(toolsets=None, mcp_server_names=None):  # noqa: ARG001
        expanded = list(SAFE_TOOLSETS)
        for server_name in list(mcp_server_names or []):
            tn = f"mcp-{server_name}"
            if server_name and tn not in expanded:
                expanded.append(tn)
        return expanded

    session._expand_acp_enabled_toolsets = _safe_expand
    print(f"[hermes-acp-readonly] toolset whitelist = {SAFE_TOOLSETS} (+ session MCP)", file=sys.stderr)


def main() -> None:
    _install_readonly_whitelist()
    # hermes_cli.main applies --profile (sets HERMES_HOME) and dispatches `acp`
    # to acp_adapter.entry — same as the stock `hermes` entry point.
    from hermes_cli.main import main as hermes_main
    hermes_main()


if __name__ == "__main__":
    main()
