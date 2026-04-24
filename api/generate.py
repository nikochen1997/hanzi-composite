"""Vercel Serverless Function - 汉字合体字生成"""

import json
import os

from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path
import re

# ===== 配置 =====
API_KEY = os.environ.get("API_KEY", "")
BASE_URL = os.environ.get("BASE_URL", "https://api.viviai.cc/v1")

# 精简版规则文件
RULES_FILE = Path(__file__).parent.parent / "合体字规则_精简版.md"

rules_cache = None


def load_rules():
    global rules_cache
    if rules_cache is not None:
        return rules_cache
    try:
        with open(RULES_FILE, "r", encoding="utf-8") as f:
            rules_cache = f.read()
    except FileNotFoundError:
        print(f"警告: 规则文件不存在 {RULES_FILE}")
        rules_cache = ""
    return rules_cache


def build_prompt(characters):
    rules = load_rules()
    word = "".join(characters)

    return f"""{rules}

现在请将以下4个字合成为一个合体字：{word}

要求：
1. 四个字的部件必须拆散重组，通过共享笔画融合为一个整体，不是简单地把四个完整的字摆在一起
2. 整体构图为正方形
3. 风格为传统毛笔书法，有墨迹质感和笔锋变化
4. 正面平视角度，90度正交俯视，无透视，无3D效果
5. 请直接生成图片"""


def call_api(prompt, attempt_number):
    variant = "（版本A：注重传统结构融合）" if attempt_number == 1 else "（版本B：注重创意意象表达）"
    final_prompt = prompt + variant

    payload = json.dumps({
        "model": "gpt-image-2",
        "messages": [{"role": "user", "content": final_prompt}],
        "max_tokens": 4096,
        "temperature": 0.8,
        "top_p": 1,
        "frequency_penalty": 0.1
    }).encode("utf-8")

    req = Request(
        f"{BASE_URL}/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        },
        method="POST"
    )

    try:
        with urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if "choices" in data and len(data["choices"]) > 0:
            message = data["choices"][0].get("message", {})
            content = message.get("content", "")

            # 检查 parts 中的 inline 图片
            for part in message.get("parts", []):
                if isinstance(part, dict):
                    inline_data = part.get("inline_data") or part.get("inlineData")
                    if inline_data:
                        mime = inline_data.get("mime_type", inline_data.get("mimeType", "image/png"))
                        b64 = inline_data.get("data", "")
                        if b64:
                            return f"data:{mime};base64,{b64}"

            # 匹配 content 中的 base64 图片
            if content:
                b64_match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                if b64_match:
                    return b64_match.group(0)

                # markdown 格式 ![image](data:image/...)
                md_match = re.search(r'!\[.*?\]\((data:image/[^\)]+)\)', content)
                if md_match:
                    return md_match.group(1)

                url_match = re.search(r'(https?://[^\s\)]+\.(?:png|jpg|jpeg|webp))', content)
                if url_match:
                    return url_match.group(1)

        raise Exception("响应中未找到图片")

    except HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        raise Exception(f"API错误 {e.code}: {error_body[:200]}")
    except URLError as e:
        raise Exception(f"网络错误: {e.reason}")


def generate_images(characters):
    prompt = build_prompt(characters)
    image = call_api(prompt, 1)
    return [image]


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            characters = data.get("characters", [])

            if not characters or len(characters) != 4:
                self._send({"success": False, "error": "请提供4个汉字"}, 400)
                return

            for ch in characters:
                if not ch or len(ch) != 1 or ord(ch) < 0x4E00 or ord(ch) > 0x9FFF:
                    self._send({"success": False, "error": f"'{ch}' 不是有效的汉字"}, 400)
                    return

            images = generate_images(characters)
            self._send({"success": True, "images": images})

        except json.JSONDecodeError:
            self._send({"success": False, "error": "请求格式错误"}, 400)
        except Exception as e:
            self._send({"success": False, "error": str(e)}, 500)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
