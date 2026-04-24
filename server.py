#!/usr/bin/env python3
"""汉字合体字生成器 - Python 后端服务"""

import os
import json
import time

from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from pathlib import Path

# ===== 配置 =====
API_KEY = "sk-Xxdgl6xcoQHBlU0Gxn7B6NxR8aB9I3edPOJDbr1SLJeVVZzS"
BASE_URL = "https://api.viviai.cc/v1"
PORT = 3000

# 精简版规则文件
RULES_FILE = Path(__file__).parent / "合体字规则_精简版.md"

rules_cache = None


def load_rules():
    global rules_cache
    if rules_cache is not None:
        return rules_cache
    try:
        with open(RULES_FILE, "r", encoding="utf-8") as f:
            rules_cache = f.read()
    except FileNotFoundError:
        print(f"  警告: 规则文件不存在 {RULES_FILE}")
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
    """调用 ViVi API 生成图片"""
    variant = "（版本A：注重传统结构融合）" if attempt_number == 1 else "（版本B：注重创意意象表达）"
    final_prompt = prompt + variant

    print(f"  [尝试 {attempt_number}] 调用 API... (prompt长度: {len(final_prompt)} 字符)")

    # 使用 OpenAI 兼容的 chat completions 接口（gpt-image-2）
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

        # 解析响应 - 查找图片数据
        if "choices" in data and len(data["choices"]) > 0:
            choice = data["choices"][0]
            message = choice.get("message", {})

            # 检查是否有 inline 图片 (base64)
            content = message.get("content", "")

            # 有些模型会在 parts 中返回图片
            parts = message.get("parts", [])
            for part in parts:
                if isinstance(part, dict):
                    inline_data = part.get("inline_data") or part.get("inlineData")
                    if inline_data:
                        mime = inline_data.get("mime_type", inline_data.get("mimeType", "image/png"))
                        b64 = inline_data.get("data", "")
                        if b64:
                            print(f"  [尝试 {attempt_number}] 成功 (inline base64)")
                            return f"data:{mime};base64,{b64}"

            # 检查 content 中是否包含 base64 图片
            if content:
                import re
                # 匹配 markdown 图片中的 base64
                b64_match = re.search(r'data:image/[^;]+;base64,([A-Za-z0-9+/=]+)', content)
                if b64_match:
                    print(f"  [尝试 {attempt_number}] 成功 (content base64)")
                    return b64_match.group(0)

                # 匹配 URL 图片
                url_match = re.search(r'(https?://[^\s\)]+\.(?:png|jpg|jpeg|webp))', content)
                if url_match:
                    print(f"  [尝试 {attempt_number}] 成功 (content url)")
                    return url_match.group(1)

            # 如果没有图片，打印内容方便调试
            print(f"  [尝试 {attempt_number}] 响应内容(前300字): {str(content)[:300]}")
            print(f"  [尝试 {attempt_number}] 完整响应keys: {list(data.keys())}")
            if "choices" in data:
                print(f"  [尝试 {attempt_number}] message keys: {list(message.keys())}")

        # 尝试 images/generations 端点作为备用
        print(f"  [尝试 {attempt_number}] chat接口无图片，尝试 images/generations 端点...")
        return call_images_api(final_prompt, attempt_number)

    except HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"  [尝试 {attempt_number}] HTTP错误 {e.code}: {error_body[:300]}")
        raise Exception(f"API返回 {e.code}: {error_body[:200]}")
    except URLError as e:
        print(f"  [尝试 {attempt_number}] 网络错误: {e.reason}")
        raise Exception(f"网络错误: {e.reason}")


def call_images_api(prompt, attempt_number):
    """备用：通过 images/generations 端点生成"""
    payload = json.dumps({
        "model": "nano-banana-2-1K",
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024"
    }).encode("utf-8")

    req = Request(
        f"{BASE_URL}/images/generations",
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

        if "data" in data and len(data["data"]) > 0:
            item = data["data"][0]
            if "b64_json" in item and item["b64_json"]:
                print(f"  [尝试 {attempt_number}] images端点成功 (base64)")
                return f"data:image/png;base64,{item['b64_json']}"
            if "url" in item and item["url"]:
                print(f"  [尝试 {attempt_number}] images端点成功 (url)")
                return item["url"]

        raise Exception("images端点响应中无图片数据")

    except HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(f"  [尝试 {attempt_number}] images端点失败 {e.code}: {error_body[:200]}")
        raise Exception(f"images端点返回 {e.code}: {error_body[:200]}")


def generate_images(characters):
    """生成1张图片"""
    word = "".join(characters)
    print(f"\n{'='*50}")
    print(f"开始为 \"{word}\" 生成图片...")
    print(f"{'='*50}")

    prompt = build_prompt(characters)
    image = call_api(prompt, 1)
    print("成功生成 1 张图片")
    return [image]


class MyHandler(SimpleHTTPRequestHandler):
    """自定义 HTTP 处理器"""

    def __init__(self, *args, **kwargs):
        # 静态文件从 frontend 目录提供
        super().__init__(*args, directory=str(Path(__file__).parent / "frontend"), **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            self.send_json({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/generate":
            self.handle_generate()
        else:
            self.send_error(404, "Not Found")

    def handle_generate(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            characters = data.get("characters", [])

            if not characters or len(characters) != 4:
                self.send_json({"success": False, "error": "请提供4个汉字"}, status=400)
                return

            # 验证汉字
            for ch in characters:
                if not ch or len(ch) != 1 or ord(ch) < 0x4E00 or ord(ch) > 0x9FFF:
                    self.send_json({"success": False, "error": f"'{ch}' 不是有效的汉字"}, status=400)
                    return

            print(f"\n[请求] 生成: {''.join(characters)}")
            images = generate_images(characters)

            self.send_json({"success": True, "images": images})

        except json.JSONDecodeError:
            self.send_json({"success": False, "error": "请求格式错误"}, status=400)
        except Exception as e:
            print(f"[错误] {e}")
            self.send_json({"success": False, "error": str(e)}, status=500)

    def send_json(self, data, status=200):
        response = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(response)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {format % args}")


def main():
    # 预加载规则
    print("加载规则文档...")
    rules = load_rules()
    loaded_count = sum(1 for v in rules.values() if v)
    print(f"已加载 {loaded_count}/{len(RULE_FILES)} 个规则文件")

    server = HTTPServer(("0.0.0.0", PORT), MyHandler)
    print(f"\n{'='*50}")
    print(f"🚀 汉字合体字生成器已启动！")
    print(f"📱 打开浏览器访问: http://localhost:{PORT}")
    print(f"🔑 API: {BASE_URL}")
    print(f"{'='*50}")
    print(f"\n按 Ctrl+C 停止服务器\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.server_close()


if __name__ == "__main__":
    main()
