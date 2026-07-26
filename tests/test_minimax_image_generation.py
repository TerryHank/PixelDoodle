import base64
import io
import asyncio
import unittest
from unittest.mock import Mock, patch

from PIL import Image
from starlette.datastructures import Headers, UploadFile

from main import (
    DEFAULT_MINIMAX_PROMPT,
    _extract_minimax_image,
    _generate_minimax_image,
    _get_minimax_dimensions,
    _image_to_data_url,
    _pick_aspect_ratio,
    _transfer_minimax_style,
    generate_ai_pattern,
)


class MiniMaxImageGenerationTests(unittest.TestCase):
    def test_picks_the_closest_supported_aspect_ratio(self):
        self.assertEqual(_pick_aspect_ratio(1920, 1080), "16:9")
        self.assertEqual(_pick_aspect_ratio(720, 1280), "9:16")
        self.assertEqual(_pick_aspect_ratio(0, 0), "1:1")

    def test_uses_low_resolution_dimensions_for_minimax(self):
        self.assertEqual(_get_minimax_dimensions("1:1"), (512, 512))
        self.assertEqual(_get_minimax_dimensions("16:9"), (912, 512))
        self.assertEqual(_get_minimax_dimensions("9:16"), (512, 912))

    def test_default_prompt_requests_a_cinematic_style_reference(self):
        self.assertIn("STYLE REFERENCE GENERATION", DEFAULT_MINIMAX_PROMPT)
        self.assertIn("photorealistic live-action cinematic photography", DEFAULT_MINIMAX_PROMPT)
        self.assertIn("used only as a style reference", DEFAULT_MINIMAX_PROMPT)

    def test_style_transfer_preserves_source_geometry(self):
        reference = Image.new("RGB", (4, 2), "black")
        for x in range(2, 4):
            for y in range(2):
                reference.putpixel((x, y), (255, 255, 255))
        style_reference = Image.new("RGB", (4, 2), (210, 90, 30))

        styled = _transfer_minimax_style(reference, style_reference)

        self.assertEqual(styled.size, reference.size)
        self.assertLess(sum(styled.getpixel((0, 0))), sum(styled.getpixel((3, 0))))

    def test_extracts_a_base64_image_from_a_success_response(self):
        image_buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(image_buffer, format="PNG")
        response = {
            "base_resp": {"status_code": 0},
            "data": {
                "image_base64": [base64.b64encode(image_buffer.getvalue()).decode("ascii")]
            },
        }

        image_bytes, media_type = _extract_minimax_image(response)

        self.assertEqual(media_type, "image/png")
        self.assertGreater(len(image_bytes), 0)

    def test_rejects_a_provider_error_response(self):
        with self.assertRaises(ValueError):
            _extract_minimax_image(
                {"base_resp": {"status_code": 1000, "status_msg": "invalid request"}}
            )

    def test_encodes_reference_image_as_a_jpeg_data_url(self):
        data_url = _image_to_data_url(Image.new("RGBA", (2, 2), "blue"))

        self.assertTrue(data_url.startswith("data:image/jpeg;base64,"))
        image_bytes = base64.b64decode(data_url.split(",", 1)[1])
        decoded_image = Image.open(io.BytesIO(image_bytes))
        self.assertEqual(decoded_image.format, "JPEG")

    def test_sends_the_reference_data_url_to_minimax(self):
        generated_buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "green").save(generated_buffer, format="PNG")
        provider_response = Mock()
        provider_response.json.return_value = {
            "id": "trace-123",
            "base_resp": {"status_code": 0},
            "data": {
                "image_base64": [
                    base64.b64encode(generated_buffer.getvalue()).decode("ascii")
                ]
            },
        }
        reference_data_url = _image_to_data_url(Image.new("RGB", (2, 2), "blue"))

        with patch.dict("main.os.environ", {"MINIMAX_API_KEY": "test-key"}), patch(
            "main.requests.post",
            return_value=provider_response,
        ) as post_mock:
            _, _, trace_id = _generate_minimax_image(
                reference_data_url,
                "Create a bead-friendly illustration",
                "1:1",
            )

        self.assertEqual(trace_id, "trace-123")
        self.assertEqual(
            post_mock.call_args.kwargs["json"]["subject_reference"][0]["image_file"],
            reference_data_url,
        )
        self.assertEqual(
            post_mock.call_args.args[0],
            "https://api.minimaxi.com/v1/image_generation",
        )
        payload = post_mock.call_args.kwargs["json"]
        self.assertEqual((payload["width"], payload["height"]), (512, 512))
        self.assertFalse(payload["prompt_optimizer"])
        self.assertNotIn("aspect_ratio", payload)

    def test_ai_endpoint_pixelates_the_generated_image_from_base64_reference(self):
        source_image = Image.new("RGB", (16, 16), "white")
        source_pixels = source_image.load()
        for y in range(16):
            for x in range(16):
                if (x + y) % 2 == 0:
                    source_pixels[x, y] = (0, 0, 0)
        source_buffer = io.BytesIO()
        source_image.save(source_buffer, format="PNG")
        generated_buffer = io.BytesIO()
        Image.new("RGB", (16, 16), "red").save(generated_buffer, format="PNG")

        with patch(
            "main._generate_minimax_image",
            return_value=(generated_buffer.getvalue(), "image/png", "trace-123"),
        ) as generate_mock, patch(
            "main._create_pattern_response",
            return_value={"grid_size": {"width": 16, "height": 16}},
        ) as create_pattern_mock:
            body = asyncio.run(
                generate_ai_pattern(
                    file=UploadFile(
                        file=io.BytesIO(source_buffer.getvalue()),
                        filename="reference.png",
                        headers=Headers({"content-type": "image/png"}),
                    ),
                    prompt="Turn the reference into a clean illustration",
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

        self.assertEqual(body["ai_trace_id"], "trace-123")
        self.assertTrue(body["ai_image"].startswith("data:image/png;base64,"))
        self.assertNotIn("ai_used", body)
        self.assertNotIn("ai_similarity_score", body)
        self.assertNotIn("ai_fallback_reason", body)
        self.assertEqual(body["grid_size"], {"width": 16, "height": 16})
        styled_image = create_pattern_mock.call_args.args[0]
        self.assertEqual(styled_image.size, source_image.size)
        self.assertNotEqual(styled_image.getpixel((0, 0)), styled_image.getpixel((1, 0)))
        response_image = Image.open(
            io.BytesIO(base64.b64decode(body["ai_image"].split(",", 1)[1]))
        )
        self.assertEqual(response_image.convert("RGB").tobytes(), styled_image.tobytes())
        self.assertTrue(generate_mock.call_args.args[0].startswith("data:image/jpeg;base64,"))
        self.assertGreaterEqual(body["ai_generation_ms"], 0)
        self.assertGreaterEqual(body["total_generation_ms"], body["ai_generation_ms"])


if __name__ == "__main__":
    unittest.main()
