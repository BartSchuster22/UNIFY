import importlib.util
import tempfile
import unittest
from pathlib import Path


class ProviderValidationPatchTest(unittest.TestCase):
    def test_exactly_covers_the_22_standard_provider_credentials(self):
        patch = Path(__file__).with_name('patch-provider-validation.py').read_text()
        expected = {
            'FIREWORKS_API_KEY', 'OPENROUTER_API_KEY', 'NOVITA_API_KEY', 'DASHSCOPE_API_KEY',
            'XIAOMI_API_KEY', 'NVIDIA_API_KEY', 'HF_TOKEN', 'DEEPSEEK_API_KEY', 'XAI_API_KEY',
            'KIMI_CN_API_KEY', 'STEPFUN_API_KEY', 'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY',
            'OLLAMA_API_KEY', 'ARCEEAI_API_KEY', 'GMI_API_KEY', 'KILOCODE_API_KEY',
            'OPENCODE_ZEN_API_KEY', 'OPENCODE_GO_API_KEY', 'AI_GATEWAY_API_KEY',
            'DEEPINFRA_API_KEY', 'UPSTAGE_API_KEY',
        }
        for key in expected:
            self.assertIn(f'"{key}":', patch)
        advanced = {
            'ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
            'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GLM_API_KEY', 'ZAI_API_KEY',
            'Z_AI_API_KEY', 'KIMI_API_KEY', 'KIMI_CODING_API_KEY',
            'ALIBABA_CODING_PLAN_API_KEY', 'AZURE_FOUNDRY_API_KEY',
            'AWS_BEARER_TOKEN_BEDROCK',
        }
        for key in advanced:
            self.assertIn(f'"{key}":', patch)
        self.assertIn('@app.put("/api/env/batch")', patch)
        self.assertIn('@app.put("/api/provider-setup/batch")', patch)
        self.assertIn('Provider endpoint must be credential-free HTTPS.', patch)
        self.assertEqual(len(expected), 22)
        self.assertNotIn('print(', patch)  # patch itself cannot print/log a submitted value

    def test_adds_cloud_and_external_identity_validation_without_secret_output(self):
        patch = Path(__file__).with_name('patch-provider-validation.py').read_text()
        for required in (
            '@app.post("/api/providers/identity/validate")',
            'provider_id not in {"bedrock", "vertex", "copilot-acp"}',
            'get_caller_identity()',
            'list_foundation_models()',
            'google.auth.default(scopes=scopes)',
            'Credentials.from_service_account_file',
            'shutil.which(command)',
            '[resolved, "--version"]',
            '"copilot-login": "unknown"',
        ):
            self.assertIn(required, patch)
        for forbidden in ('access_key', 'secret_key', 'access_token":', 'refresh_token":'):
            self.assertNotIn(forbidden, patch)

    def test_adds_qwen_device_code_lifecycle_without_embedded_credentials(self):
        patch = Path(__file__).with_name('patch-provider-validation.py').read_text()
        for required in (
            '"id": "qwen-oauth"',
            '"flow": "device_code"',
            'def _qwen_device_poller',
            'https://chat.qwen.ai/api/v1/oauth2/device/code',
            'QWEN_OAUTH_TOKEN_URL',
            '_save_qwen_cli_tokens',
            'status"] = "expired"',
            'status"] = "denied"',
        ):
            self.assertIn(required, patch)
        self.assertNotIn('access_token": "', patch)
        self.assertNotIn('refresh_token": "', patch)


if __name__ == '__main__':
    unittest.main()
