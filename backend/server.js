const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { generateImages } = require('./generate');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 静态文件服务 - 前端页面
app.use(express.static(path.join(__dirname, '../frontend')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 生成API
app.post('/api/generate', async (req, res) => {
  try {
    const { characters } = req.body;

    if (!characters || !Array.isArray(characters) || characters.length !== 4) {
      return res.status(400).json({
        success: false,
        error: '请提供4个汉字字符数组'
      });
    }

    // 验证都是汉字
    const isValid = characters.every(char =>
      char && char.length === 1 && /[\u4e00-\u9fa5]/.test(char)
    );

    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: '输入必须是有效的汉字'
      });
    }

    console.log(`[生成请求] ${characters.join('')}`);

    // 并行生成2张图片
    const images = await generateImages(characters);

    res.json({
      success: true,
      images
    });

  } catch (error) {
    console.error('生成失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '生成失败，请重试'
    });
  }
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 汉字合体字生成器服务器运行在 http://localhost:${PORT}`);
  console.log(`📱 打开浏览器访问 http://localhost:${PORT} 即可使用`);
});
