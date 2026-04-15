"""Vercel Serverless Function - 汉字合体字生成"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pathlib import Path
import re

# ===== 配置 =====
API_KEY = os.environ.get("API_KEY", "")
BASE_URL = os.environ.get("BASE_URL", "https://api.viviai.cc/v1")

# 规则文件路径（相对于项目根目录）
RULES_DIR = Path(__file__).parent.parent / "rules"
RULE_FILES = ["拓扑编码库.md", "几何优化库.md", "风格特征库.md", "语义校验库.md"]

rules_cache = None


def load_rules():
    global rules_cache
    if rules_cache is not None:
        return rules_cache

    rules = {}
    for filename in RULE_FILES:
        filepath = RULES_DIR / filename
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                rules[filename.replace(".md", "")] = f.read()
        except FileNotFoundError:
            print(f"警告: 规则文件不存在 {filepath}")
            rules[filename.replace(".md", "")] = ""

    rules_cache = rules
    return rules


def build_prompt(characters):
    rules = load_rules()
    word = "".join(characters)

    return f"""你是一个专业的中国书法合体字设计师。你需要根据以下四个规则库，将用户给你的4个汉字合成为一个艺术合体字。

== 拓扑编码库 ==
{rules.get('拓扑编码库', '')}

== 几何优化库 ==
{rules.get('几何优化库', '')}

== 风格特征库 ==
{rules.get('风格特征库', '')}

== 语义校验库 ==
{rules.get('语义校验库', '')}

现在请将以下4个字合成为一个合体字：{word}

要求：
1. 四个字的部件必须拆散重组，通过共享笔画融合为一个整体，不是简单地把四个完整的字摆在一起
2. 整体构图为正方形
3. 风格为传统毛笔书法，有墨迹质感和笔锋变化
4. 正面平视角度，90度正交俯视，无透视，无3D效果
5. 可以根据词语含义进行意象化设计（如将特征性的笔画异化为与词义相关的图形）
6. 请直接生成图片"""


def call_api(prompt, attempt_number):
    variant = "（版本A：注重传统结构融合）" if attempt_number == 1 else "（版本B：注重创意意象表达）"
    final_prompt = prompt + variant

    payload = json.dumps({
        "model": "nano-banana-2",
        "messages": [{"role": "user", "content": final_prompt}],
        "max_tokens": 4096
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

    results = [None, None]
    errors = [None, None]

    def worker(index):
        try:
            results[index] = call_api(prompt, index + 1)
        except Exception as e:
            errors[index] = str(e)

    t1 = threading.Thread(target=worker, args=(0,))
    t2 = threading.Thread(target=worker, args=(1,))
    t1.start()
    t2.start()
    t1.join(timeout=180)
    t2.join(timeout=180)

    images = [r for r in results if r is not None]
    if images:
        return images

    error_msgs = [e for e in errors if e is not None]
    raise Exception("生成失败: " + "; ".join(error_msgs))


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
