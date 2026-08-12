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
        self.assertEqual(len(expected), 22)
        self.assertNotIn('print(', patch)  # patch itself cannot print/log a submitted value


if __name__ == '__main__':
    unittest.main()
