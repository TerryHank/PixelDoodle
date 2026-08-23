import base64
import io
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image
from starlette.datastructures import Headers, UploadFile

from main import (
    DEFAULT_DASHSCOPE_STYLE_INDEX,
    _dashscope_http_error_detail,
    _image_bytes_to_data_url,
    _persist_ai_input,
    _persist_ai_output,
    _pick_aspect_ratio,
    generate_ai_pattern,
)


class DashScopeImageGenerationTests(unittest.TestCase):
    def test_picks_the_closest_supported_aspect_ratio(self):
        self.assertEqual(_pick_aspect_ratio(1920, 1080), "16:9")
        self.assertEqual(_pick_aspect_ratio(720, 1280), "9:16")
        self.assertEqual(_pick_aspect_ratio(0, 0), "1:1")

    def test_default_style_is_japanese_anime_world(self):
        self.assertEqual(DEFAULT_DASHSCOPE_STYLE_INDEX, 34)

    def test_encodes_reference_bytes_to_base64_data_url(self):
        image_buffer = io.BytesIO()
        Image.new("RGBA", (2, 2), "blue").save(image_buffer, format="PNG")
        original_bytes = image_buffer.getvalue()
        data_url = _image_bytes_to_data_url(original_bytes, "image/png")
        self.assertTrue(data_url.startswith("data:image/png;base64,"))
        decoded = base64.b64decode(data_url.split(",", 1)[1])
        self.assertEqual(decoded, original_bytes)

    def test_persists_original_input_and_model_output(self):
        with tempfile.TemporaryDirectory() as td, patch(
            "main.AI_GENERATIONS_DIR", Path(td)
        ):
            gid, inp = _persist_ai_input(b"input", "image/png", "test.png", "gen-1")
            outp = _persist_ai_output(gid, b"output", "image/jpeg")
            self.assertEqual(Path(inp).read_bytes(), b"input")
            self.assertEqual(Path(outp).read_bytes(), b"output")

    def test_dashscope_http_errors_keep_provider_diagnostics(self):
        response = Mock(status_code=400)
        response.json.return_value = {
            "code": "InvalidURL",
            "message": "The request URL is invalid",
            "request_id": "request-123",
        }

        detail = _dashscope_http_error_detail("DashScope request failed", response)

        self.assertIn("HTTP 400", detail)
        self.assertIn("InvalidURL", detail)
        self.assertIn("The request URL is invalid", detail)
        self.assertIn("request_id=request-123", detail)

    def test_dashscope_submit_uses_async_header_and_image_url(self):
        with patch.dict("main.os.environ", {"DASHSCOPE_API_KEY": "test-key"}), patch(
            "main.requests.post"
        ) as post_mock, patch(
            "main._poll_dashscope_task",
            return_value=(b"generated-image", "image/png"),
        ):
            resp = Mock()
            resp.json.return_value = {"output": {"task_id": "task-1"}}
            post_mock.return_value = resp

            from main import _generate_dashscope_style
            _generate_dashscope_style("https://example.com/ref.jpg", 3)

            call_args = post_mock.call_args
            self.assertEqual(
                call_args.kwargs["headers"]["X-DashScope-Async"], "enable"
            )
            payload = call_args.kwargs["json"]
            self.assertEqual(payload["model"], "wanx-style-repaint-v1")
            self.assertEqual(payload["input"]["image_url"], "https://example.com/ref.jpg")
            self.assertEqual(payload["input"]["style_index"], 3)

    def test_ai_endpoint_uses_base64_and_passes_style_index_to_dashscope(self):
        source = Image.new("RGB", (16, 16), "white")
        buf = io.BytesIO()
        source.save(buf, format="PNG")

        gen = Image.new("RGB", (16, 16), "red")
        gen_buf = io.BytesIO()
        gen.save(gen_buf, format="PNG")

        with tempfile.TemporaryDirectory() as td, patch(
            "main.AI_GENERATIONS_DIR", Path(td)
        ), patch.dict(
            "main.os.environ",
            {"PIXELDOODLE_PUBLIC_BASE_URL": "https://beadcraft.cvalab.top"},
        ), patch(
            "main.remove_background",
            return_value=buf.getvalue(),
        ) as remove_background_mock, patch(
            "main._generate_dashscope_style",
            return_value=(gen_buf.getvalue(), "image/png", "task-42"),
        ) as generate_mock, patch(
            "main._create_pattern_response",
            return_value={"grid_size": {"width": 16, "height": 16}},
        ):
            body = asyncio.run(
                generate_ai_pattern(
                    file=UploadFile(
                        file=io.BytesIO(buf.getvalue()),
                        filename="ref.png",
                        headers=Headers({"content-type": "image/png"}),
                    ),
                    style_index=7,
                    reference_image_url="",
                    aspect_ratio="1:1",
                    mode="fixed_grid",
                    grid_width=16,
                    grid_height=16,
                    led_size=64,
                    pixel_size=8,
                    use_dithering="false",
                    palette_preset="221",
                    max_colors=0,
                    similarity_threshold=0,
                    remove_bg="false",
                    contrast=0,
                    saturation=0,
                    sharpness=0,
                )
            )

        reference_value, selected_style = generate_mock.call_args.args
        remove_background_mock.assert_not_called()
        self.assertTrue(reference_value.startswith("data:image/png;base64,"))
        self.assertEqual(
            base64.b64decode(reference_value.split(",", 1)[1]),
            buf.getvalue(),
        )
        self.assertEqual(selected_style, 7)
        self.assertEqual(body["ai_trace_id"], "task-42")
        self.assertTrue(body["ai_image"].startswith("data:image/png;base64,"))
        self.assertEqual(body["grid_size"], {"width": 16, "height": 16})
        self.assertNotIn("ai_reference_url", body)


if __name__ == "__main__":
    unittest.main()
