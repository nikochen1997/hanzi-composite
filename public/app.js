/* ===== 数据 ===== */
// 每次页面加载从中随机抽 8 个展示（刷新即换一批）
const PRESET_POOL = [
  '逢考必过', '财源广进', '心想事成', '万事如意',
  '恭喜发财', '一帆风顺', '马到成功', '喜上眉梢',
  '步步高升', '龙马精神', '花开富贵', '年年有余',
  '岁岁平安', '大吉大利', '五福临门', '六六大顺',
  '七星高照', '八方来财', '九九同心', '十全十美',
  '金玉满堂', '笑口常开', '前程似锦', '鹏程万里',
  '旗开得胜', '蒸蒸日上', '日新月异', '春华秋实',
  '和气生财', '招财进宝', '日进斗金', '双喜临门',
  '紫气东来', '学业有成', '才高八斗', '博学多才',
  '温故知新', '举一反三', '持之以恒', '精益求精',
  '实事求是', '脚踏实地', '顶天立地', '厚德载物',
  '自强不息', '水到渠成', '画龙点睛', '开门见山',
  '锦上添花', '雪中送炭', '百里挑一', '一鸣惊人',
  '百尺竿头', '更进一步', '同舟共济', '众志成城',
  '国泰民安', '风调雨顺', '五谷丰登', '六畜兴旺',
  '阖家欢乐', '天伦之乐', '相亲相爱', '百年好合',
  '早生贵子', '连中三元', '金榜题名', '出人头地'
];
const PRESET_DISPLAY_COUNT = 8;

function shufflePick(pool, count) {
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr.slice(0, Math.min(count, arr.length));
}

const LOADING_MESSAGES = [
  '正在拆解汉字结构...',
  '正在设计合体布局...',
  '正在渲染书法效果...',
  '即将完成...'
];

// 后端API地址（Vercel部署时与前端同域）
const API_BASE = '';

// 本地历史：仅存缩略图 URL/base64，且条数有上限（避免 localStorage 约 5MB 配额导致「合成失败」误报）
const HISTORY_KEY = 'hechengzhi_history';
const MAX_HISTORY_ITEMS = 20;

function normalizeHistoryEntry(raw) {
  if (!raw || typeof raw.word !== 'string' || raw.word.length !== 4) return null;
  const selectedImage =
    raw.selectedImage ||
    (Array.isArray(raw.allImages) && raw.allImages[0]) ||
    '';
  if (!selectedImage) return null;
  return {
    id: typeof raw.id === 'number' ? raw.id : Date.now(),
    word: raw.word,
    selectedImage,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now()
  };
}

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const n = normalizeHistoryEntry(item);
      if (n) out.push(n);
    }
    return out.slice(0, MAX_HISTORY_ITEMS);
  } catch (_) {
    return [];
  }
}

let history = loadHistory();

/* ===== 状态 ===== */
let inputChars = ['', '', '', ''];
let activeIndex = 0;
let editMode = false;
let currentImages = [];
let selectedImageIndex = -1;
let loadingTimer = null;
let currentWord = '';

/* ===== 初始化 ===== */
function init() {
  renderCharInputs();
  renderPresets();
  renderRecent();
  renderHistory();
  saveHistory();
  updateClock();
  setInterval(updateClock, 60000);

  const hiddenInput = document.getElementById('hiddenInput');
  hiddenInput.addEventListener('input', function(e) {
    const char = e.target.value;
    if (char && /[\u4e00-\u9fa5]/.test(char)) {
      inputChars[activeIndex] = char;
      e.target.value = '';
      if (activeIndex < 3) {
        activeIndex++;
      }
      renderCharInputs();
      hiddenInput.focus();
    }
  });

  document.addEventListener('click', function(e) {
    if (e.target.closest('.char-box')) {
      const index = parseInt(e.target.closest('.char-box').dataset.index);
      if (!isNaN(index)) {
        activeIndex = index;
        renderCharInputs();
        hiddenInput.focus();
      }
    }
  });
}

/* ===== 合成页面功能 ===== */
function renderCharInputs() {
  const container = document.getElementById('charInputs');
  container.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const box = document.createElement('div');
    const hasChar = inputChars[i] && inputChars[i].trim();
    box.className = `char-box ${!hasChar ? 'empty' : 'has-content'} ${i === activeIndex ? 'active' : ''}`;
    box.dataset.index = i;
    box.textContent = hasChar ? inputChars[i] : '+';
    container.appendChild(box);
  }
  updateComposeButton();
}

function renderPresets() {
  const container = document.getElementById('hintChips');
  container.innerHTML = '';
  shufflePick(PRESET_POOL, PRESET_DISPLAY_COUNT).forEach(word => {
    const chip = document.createElement('div');
    chip.className = 'hint-chip';
    chip.textContent = word;
    chip.onclick = () => {
      inputChars = word.split('');
      activeIndex = 3;
      renderCharInputs();
    };
    container.appendChild(chip);
  });
}

function updateComposeButton() {
  const btn = document.getElementById('composeBtn');
  const hasAllChars = inputChars.every(c => c && c.trim());
  btn.disabled = !hasAllChars;
}

function recordSuccessfulGeneration(word, images) {
  if (!word || word.length !== 4 || !images || !images.length) return;
  const id = Date.now();
  history.unshift({
    id,
    word,
    selectedImage: images[0],
    timestamp: id
  });
  while (history.length > MAX_HISTORY_ITEMS) history.pop();
  saveHistory();
  renderRecent();
  const historyPage = document.getElementById('historyPage');
  if (historyPage && historyPage.classList.contains('active')) {
    renderHistory();
  }
}

function renderRecent() {
  const container = document.getElementById('recentList');
  container.innerHTML = '';
  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'recent-empty';
    empty.textContent = '生成成功后会出现在这里';
    container.appendChild(empty);
    return;
  }
  history.slice(0, 10).forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.onclick = () => viewHistoryItem(item);
    const thumbContent = item.selectedImage
      ? `<img src="${item.selectedImage}" alt="${item.word}" style="width:100%;height:100%;object-fit:cover;">`
      : `<span style="font-size:32px;color:var(--text-primary);">${item.word[0]}</span>`;
    div.innerHTML = `
      <div class="history-thumb">${thumbContent}</div>
      <div class="history-word">${item.word}</div>
    `;
    container.appendChild(div);
  });
}

async function startCompose() {
  const word = inputChars.join('');
  if (!word || word.length !== 4) {
    alert('请输入4个汉字');
    return;
  }

  currentWord = word;
  selectedImageIndex = -1;
  currentImages = [];

  // 切换到加载状态
  document.getElementById('inputState').classList.remove('active');
  document.getElementById('loadingState').classList.add('active');

  // 初始化加载动画
  startLoadingAnimation();

  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters: inputChars })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || '生成失败');
    }

    currentImages = data.images;

    // 停止加载动画
    stopLoadingAnimation();

    // 显示结果
    document.getElementById('loadingState').classList.remove('active');
    document.getElementById('resultState').classList.add('active');

    // 渲染双图
    renderDualImages();
    try {
      recordSuccessfulGeneration(currentWord, currentImages);
    } catch (e) {
      console.warn('写入本地历史失败（不影响本次生成）', e);
    }

  } catch (err) {
    stopLoadingAnimation();
    console.error('合成失败:', err);
    alert('合成失败: ' + err.message);
    document.getElementById('loadingState').classList.remove('active');
    document.getElementById('inputState').classList.add('active');
  }
}

function startLoadingAnimation() {
  let step = 0;
  const textEl = document.getElementById('loadingText');
  textEl.textContent = LOADING_MESSAGES[0];

  // 更新进度点
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('d' + i);
    d.className = 'step-dot' + (i === 0 ? ' active' : '');
  }

  loadingTimer = setInterval(() => {
    step = (step + 1) % LOADING_MESSAGES.length;
    textEl.textContent = LOADING_MESSAGES[step];

    // 更新进度点
    for (let i = 0; i < 4; i++) {
      const d = document.getElementById('d' + i);
      d.className = 'step-dot' + (i === step ? ' active' : '');
    }
  }, 2000);
}

function stopLoadingAnimation() {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

function renderDualImages() {
  const container = document.getElementById('dualImages');
  container.innerHTML = '';

  // 单张大图展示
  if (currentImages.length > 0) {
    selectedImageIndex = 0;
    const option = document.createElement('div');
    option.className = 'image-option single';
    option.innerHTML = `<img src="${currentImages[0]}" alt="合成字">`;
    container.appendChild(option);
  }

  document.getElementById('resultWord').textContent = currentWord;

  // 直接启用按钮
  const actions = document.getElementById('resultActions');
  actions.style.opacity = '1';
  actions.style.pointerEvents = 'auto';
}

async function regenerate() {
  const btn = document.querySelector('.btn-action-primary');
  btn.textContent = '生成中...';
  btn.disabled = true;

  try {
    inputChars = currentWord.split('');

    // 回到加载状态
    document.getElementById('resultState').classList.remove('active');
    document.getElementById('loadingState').classList.add('active');
    startLoadingAnimation();

    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters: inputChars })
    });

    const data = await response.json();
    stopLoadingAnimation();

    if (!data.success) throw new Error(data.error || '生成失败');

    currentImages = data.images;
    selectedImageIndex = 0;

    document.getElementById('loadingState').classList.remove('active');
    document.getElementById('resultState').classList.add('active');
    renderDualImages();
    try {
      recordSuccessfulGeneration(currentWord, currentImages);
    } catch (e) {
      console.warn('写入本地历史失败（不影响本次生成）', e);
    }

  } catch (err) {
    stopLoadingAnimation();
    alert('重新生成失败: ' + err.message);
    document.getElementById('loadingState').classList.remove('active');
    document.getElementById('resultState').classList.add('active');
  } finally {
    btn.textContent = '重新生成';
    btn.disabled = false;
  }
}

async function saveResult() {
  if (selectedImageIndex < 0 || !currentImages[selectedImageIndex]) return;

  const btn = document.getElementById('saveBtn');
  btn.textContent = '保存中...';

  try {
    const imageUrl = currentImages[selectedImageIndex];

    // 下载图片
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `汉字合成_${currentWord}_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // 历史已在生成成功时写入，此处仅下载文件

    btn.textContent = '已保存 ✓';
    btn.classList.add('saved');
    setTimeout(() => {
      btn.textContent = '保存图片';
      btn.classList.remove('saved');
    }, 2000);

  } catch (err) {
    alert('保存失败: ' + err.message);
    btn.textContent = '保存图片';
  }
}

function backToInput() {
  document.getElementById('resultState').classList.remove('active');
  document.getElementById('inputState').classList.add('active');

  // 重置状态
  inputChars = ['', '', '', ''];
  activeIndex = 0;
  selectedImageIndex = -1;
  currentImages = [];
  renderCharInputs();

  // 重置结果区域
  document.getElementById('saveBtn').textContent = '保存图片';
  document.getElementById('saveBtn').classList.remove('saved');
}

function viewHistoryItem(item) {
  if (!item || !item.word) return;
  if (!item.allImages || item.allImages.length === 0) {
    if (!item.selectedImage) return;
    currentImages = [item.selectedImage];
  } else {
    currentImages = item.allImages;
  }

  currentWord = item.word;

  selectedImageIndex = currentImages.indexOf(item.selectedImage);
  if (selectedImageIndex < 0) selectedImageIndex = 0;

  // 显示结果
  document.getElementById('inputState').classList.remove('active');
  document.getElementById('loadingState').classList.remove('active');
  document.getElementById('resultState').classList.add('active');

  renderDualImages();

  switchTab('compose');
}

/* ===== 历史页面功能 ===== */
function renderHistory() {
  const container = document.getElementById('historyGrid');
  const emptyState = document.getElementById('emptyState');
  const countEl = document.getElementById('historyCount');

  countEl.textContent = `共 ${history.length} 个合成字`;

  if (history.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  container.innerHTML = '';
  history.forEach((item) => {
    const card = document.createElement('div');
    card.className = `history-card ${editMode ? 'edit-mode' : ''}`;

    const glyphDisplay = item.selectedImage
      ? `<img src="${item.selectedImage}" alt="${item.word}" style="width:100%;height:100%;object-fit:cover;">`
      : `<span style="font-size:64px;color:var(--text-primary);">${item.word[0]}</span>`;

    card.innerHTML = `
      <div class="delete-dot" onclick="event.stopPropagation(); deleteItem(${item.id})">×</div>
      <div class="card-glyph">${glyphDisplay}</div>
      <div class="card-word">${item.word}</div>
      <div class="card-date">${formatDate(item.timestamp)}</div>
      <div class="card-actions">
        <div class="card-btn" onclick="event.stopPropagation(); regenHistoryItem('${item.word}')">再来一张</div>
        <div class="card-btn save" onclick="event.stopPropagation(); saveHistoryItem(${item.id})">保存</div>
      </div>
    `;
    card.onclick = () => viewHistoryItem(item);
    container.appendChild(card);
  });
}

function toggleEdit() {
  editMode = !editMode;
  document.getElementById('editBtn').textContent = editMode ? '完成' : '编辑';
  document.getElementById('editLabel').textContent = editMode ? '点击 × 删除' : '点击卡片查看详情';
  renderHistory();
}

function deleteItem(id) {
  history = history.filter(h => h.id !== id);
  saveHistory();
  renderHistory();
  renderRecent();
}

async function regenHistoryItem(word) {
  inputChars = word.split('');
  activeIndex = 3;
  await startCompose();
}

async function saveHistoryItem(id) {
  const item = history.find(h => h.id === id);
  if (!item || !item.selectedImage) return;

  try {
    const response = await fetch(item.selectedImage);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `汉字合成_${item.word}_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

  } catch (err) {
    alert('保存失败: ' + err.message);
  }
}

/* ===== 工具函数 ===== */
function switchTab(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));

  if (tab === 'compose') {
    document.getElementById('composePage').classList.add('active');
  } else {
    document.getElementById('historyPage').classList.add('active');
    renderHistory();
  }

  document.querySelectorAll('.tab-item').forEach((t, i) => {
    if ((tab === 'compose' && i === 0) || (tab === 'history' && i === 1)) {
      t.classList.add('active');
    }
  });
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isYesterday = date.toDateString() === new Date(now - 86400000).toDateString();

  if (isToday) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isYesterday) return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function isQuotaError(e) {
  return (
    e &&
    (e.name === 'QuotaExceededError' ||
      e.code === 22 ||
      e.code === 1014)
  );
}

function saveHistory() {
  const slimRow = (h) => ({
    id: h.id,
    word: h.word,
    selectedImage: h.selectedImage,
    timestamp: h.timestamp
  });

  while (history.length > MAX_HISTORY_ITEMS) history.pop();

  const tryWrite = (rows) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows));
  };

  let rows = history.map(slimRow);
  try {
    tryWrite(rows);
    return;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn('saveHistory', e);
      return;
    }
  }

  while (history.length > 0) {
    history.pop();
    rows = history.map(slimRow);
    try {
      tryWrite(rows);
      return;
    } catch (e) {
      if (!isQuotaError(e)) {
        console.warn('saveHistory(trim)', e);
        return;
      }
    }
  }

  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (_) {}
}

/* ===== 启动 ===== */
init();
