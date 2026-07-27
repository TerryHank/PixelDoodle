import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
APP_JS = REPO_ROOT / "static" / "app.js"
INDEX_HTML = REPO_ROOT / "templates" / "index.html"
I18N_JS = REPO_ROOT / "static" / "i18n.js"
STYLE_CSS = REPO_ROOT / "static" / "style.css"


def get_function_body(content: str, name: str) -> str:
    match = re.search(rf"(?:async\s+)?function {re.escape(name)}\([^)]*\) \{{(?P<body>.*?)\n\}}", content, re.S)
    if not match:
        raise AssertionError(f"{name} function not found")
    return match.group("body")


class GenerationLoadingOverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app_js = APP_JS.read_text(encoding="utf-8")
        cls.index_html = INDEX_HTML.read_text(encoding="utf-8")
        cls.i18n_js = I18N_JS.read_text(encoding="utf-8")
        cls.style_css = STYLE_CSS.read_text(encoding="utf-8")

    def test_template_renders_generation_loading_overlay(self):
        self.assertIn('id="generation-loading-overlay"', self.index_html)
        self.assertIn('class="generation-loading-card"', self.index_html)
        self.assertIn('class="generation-loading-spinner"', self.index_html)
        self.assertIn('id="generation-loading-text"', self.index_html)
        self.assertIn('图片生成中...', self.index_html)

    def test_i18n_contains_generating_image_copy(self):
        self.assertIn("'toast.generating_image': '图片生成中...'", self.i18n_js)
        self.assertIn("'toast.generating_image': 'Generating image...'", self.i18n_js)

    def test_styles_define_overlay_and_spinner_states(self):
        self.assertIn('.generation-loading-overlay {', self.style_css)
        self.assertIn('.generation-loading-overlay.visible {', self.style_css)
        self.assertIn('.generation-loading-card {', self.style_css)
        self.assertIn('.generation-loading-spinner {', self.style_css)
        self.assertIn('.generation-loading-text {', self.style_css)

    def test_app_state_tracks_generation_lock(self):
        self.assertIn('isGenerating: false', self.app_js)

    def test_set_generation_loading_helper_updates_overlay(self):
        body = get_function_body(self.app_js, 'setGenerationLoading')
        self.assertIn("document.getElementById('generation-loading-overlay')", body)
        self.assertIn("document.getElementById('generation-loading-text')", body)
        self.assertIn("window.appState.isGenerating = isLoading;", body)
        self.assertIn("overlay.classList.toggle('visible', isLoading);", body)
        self.assertIn("overlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');", body)
        self.assertIn("text.textContent = t('toast.generating_image');", body)

    def test_generate_pattern_shows_overlay_and_blocks_reentry(self):
        body = get_function_body(self.app_js, 'generatePattern')
        self.assertIn('if (window.appState.isGenerating) {', body)
        self.assertIn('setGenerationLoading(true);', body)
        self.assertIn('} finally {', body)
        self.assertIn('setGenerationLoading(false);', body)


if __name__ == "__main__":
    unittest.main()
