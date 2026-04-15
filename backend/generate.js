const fs = require('fs').promises;
const path = require('path');

// 规则文件路径
const RULES_DIR = path.join(__dirname, 'rules');
const RULE_FILES = [
  '拓扑编码库.md',
  '几何优化库.md',
  '风格特征库.md',
  '语义校验库.md'
];

// 缓存规则内容
let rulesCache = null;

/**
 * 加载所有规则文档
 */
async function loadRules() {
  if (rulesCache) return rulesCache;

  const rules = {};

  for (const file of RULE_FILES) {
    try {
      const content = await fs.readFile(path.join(RULES_DIR, file), 'utf-8');
      rules[file.replace('.md', '')] = content;
    } catch (err) {
      console.warn(`警告: 无法读取规则文件 ${file}`, err.message);
      rules[file.replace('.md', '')] = '';
    }
  }

  rulesCache = rules;
  return rules;
}

/**
 * 构建Prompt
 */
async function buildPrompt(characters) {
  const rules = await loadRules();
  const word = characters.join('');

  return `你是一个专业的中国书法合体字设计师。你需要根据以下四个规则库，将用户给你的4个汉字合成为一个艺术合体字。

== 拓扑编码库 ==
${rules['拓扑编码库']}

== 几何优化库 ==
${rules['几何优化库']}

== 风格特征库 ==
${rules['风格特征库']}

== 语义校验库 ==
${rules['语义校验库']}

现在请将以下4个字合成为一个合体字：${word}

要求：
1. 四个字的部件必须拆散重组，通过共享笔画融合为一个整体，不是简单地把四个完整的字摆在一起
2. 整体构图为正方形
3. 风格为传统毛笔书法，有墨迹质感和笔锋变化
4. 正面平视角度，90度正交俯视，无透视，无3D效果
5. 可以根据词语含义进行意象化设计（如将特征性的笔画异化为与词义相关的图形）
6. 请直接生成图片`;
}

/**
 * 通过 OpenAI 兼容 API 生成图片
 */
async function generateViaOpenAI(prompt) {
  const apiKey = process.env.API_KEY;
  const baseURL = process.env.BASE_URL || 'https://api.viviai.cc/v1';

  if (!apiKey) {
    throw new Error('未设置 API_KEY');
  }

  const response = await fetch(`${baseURL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'nanobanana-2',  // 或者根据实际支持的模型名称调整
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // 处理不同格式的响应
  if (data.data && data.data[0]) {
    if (data.data[0].b64_json) {
      return `data:image/png;base64,${data.data[0].b64_json}`;
    }
    if (data.data[0].url) {
      return data.data[0].url;
    }
  }

  throw new Error('无法从响应中提取图片');
}

/**
 * 生成单张图片
 */
async function generateSingleImage(characters, attemptNumber) {
  const prompt = await buildPrompt(characters);

  // 添加随机性，确保两次生成不同
  const variantHint = attemptNumber === 1
    ? '（版本A：注重传统结构融合）'
    : '（版本B：注重创意意象表达）';

  const finalPrompt = prompt + variantHint;

  console.log(`  [尝试 ${attemptNumber}] 调用 API...`);
  console.log(`  [尝试 ${attemptNumber}] 提示词长度: ${finalPrompt.length} 字符`);

  try {
    const imageData = await generateViaOpenAI(finalPrompt);
    console.log(`  [尝试 ${attemptNumber}] 图片生成成功`);
    return imageData;
  } catch (error) {
    console.error(`  [尝试 ${attemptNumber}] 失败:`, error.message);
    throw error;
  }
}

/**
 * 并行生成2张图片
 */
async function generateImages(characters) {
  const word = characters.join('');
  console.log(`开始为 "${word}" 生成2张图片...`);

  // 并行执行两次生成
  const promises = [
    generateSingleImage(characters, 1),
    generateSingleImage(characters, 2)
  ];

  const results = await Promise.allSettled(promises);

  const images = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      images.push(result.value);
    } else {
      errors.push(`图片${index + 1}: ${result.reason.message}`);
    }
  });

  // 如果至少有一张成功，返回结果
  if (images.length > 0) {
    console.log(`成功生成 ${images.length} 张图片`);
    return images;
  }

  // 全部失败时抛出错误
  throw new Error('图片生成失败: ' + errors.join('; '));
}

module.exports = {
  generateImages
};
