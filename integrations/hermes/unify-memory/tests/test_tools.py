from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOOLS_PATH = Path(__file__).resolve().parents[1] / "tools.py"
spec = importlib.util.spec_from_file_location("unify_memory_tools", TOOLS_PATH)
assert spec and spec.loader
memory_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(memory_tools)


class Handler(BaseHTTPRequestHandler):
    calls = []
    contract = "1.0.0"

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length))
        type(self).calls.append((self.path, dict(self.headers), body))
        payload = json.dumps({"ok": True, "path": self.path}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("x-memoryv4-contract-version", type(self).contract)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_):
        pass


class MemoryPluginTest(unittest.TestCase):
    def setUp(self):
        Handler.calls = []
        Handler.contract = "1.0.0"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        token_path = Path(self.temp.name) / "bundle.json"
        token_path.write_text(json.dumps({"active": {"token": "test-framework-token-adequate-length"}}))
        os.environ["UNIFY_MEMORY_GATEWAY_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        os.environ["UNIFY_MEMORY_TOKEN_BUNDLE_FILE"] = str(token_path)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()
        os.environ.pop("UNIFY_MEMORY_GATEWAY_URL", None)
        os.environ.pop("UNIFY_MEMORY_TOKEN_BUNDLE_FILE", None)

    def test_search_uses_gateway_bearer_and_pinned_contract(self):
        result = json.loads(memory_tools.handle_search({"q": "phase 10", "limit": 5}))
        self.assertTrue(result["success"])
        path, headers, body = Handler.calls[0]
        self.assertEqual(path, "/api/v1/framework-tools/memory/search")
        self.assertEqual(headers["Authorization"], "Bearer test-framework-token-adequate-length")
        self.assertEqual(body, {"q": "phase 10", "limit": 5})
        Handler.contract = "9.9.9"
        mismatch = json.loads(memory_tools.handle_search({"q": "phase 10"}))
        self.assertFalse(mismatch["success"])
        self.assertEqual(mismatch["error"]["code"], "UNIFY_MEMORY_UNAVAILABLE")

    def test_mutation_idempotency_is_stable_and_operation_scoped(self):
        args = {"title": "Fact", "content": "Value", "operation_id": "op-1"}
        memory_tools.handle_remember(args)
        memory_tools.handle_remember(args)
        memory_tools.handle_remember({**args, "operation_id": "op-2"})
        keys = [headers["Idempotency-Key"] for _, headers, _ in Handler.calls]
        self.assertEqual(keys[0], keys[1])
        self.assertNotEqual(keys[0], keys[2])
        self.assertNotIn("operation_id", Handler.calls[0][2])

    def test_plaintext_is_restricted_to_explicit_private_hosts(self):
        os.environ["UNIFY_MEMORY_GATEWAY_URL"] = "http://memory.example.invalid:8080"
        result = json.loads(memory_tools.handle_search({"q": "x"}))
        self.assertFalse(result["success"])
        self.assertIn("not a permitted origin", result["error"]["message"])
        self.assertEqual(Handler.calls, [])

    def test_schemas_expose_only_governed_read_and_working_write_tools(self):
        names = [item[0] for item in memory_tools.TOOLS]
        self.assertEqual(
            names,
            [
                "unify_memory_search",
                "unify_memory_context",
                "unify_memory_get",
                "unify_memory_remember",
                "unify_memory_update",
            ],
        )
        self.assertNotIn("promote", " ".join(names))
        self.assertIn("operation_id", memory_tools.REMEMBER_SCHEMA["parameters"]["required"])
        self.assertIn("operation_id", memory_tools.UPDATE_SCHEMA["parameters"]["required"])
        record_fields = memory_tools.REMEMBER_SCHEMA["parameters"]["properties"]
        self.assertEqual(record_fields["content"]["maxLength"], 1_000_000)
        self.assertEqual(record_fields["source_refs"]["maxItems"], 100)
        self.assertEqual(record_fields["source_refs"]["items"]["maxLength"], 2048)
        self.assertEqual(record_fields["scope_path"]["maxLength"], 1000)


if __name__ == "__main__":
    unittest.main()
