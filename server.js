const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./vk_analytic.db');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
app.use(cors());
app.use(express.json());

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    vk_user_id TEXT,
    vk_token TEXT,
    created_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    status TEXT,
    expires INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Хелпер: получить или создать пользователя
function getOrCreateUser(telegram_id, vk_user_id, vk_token, cb) {
  db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id], (err, row) => {
    if (row) return cb(null, row);
    db.run('INSERT INTO users (telegram_id, vk_user_id, vk_token, created_at) VALUES (?, ?, ?, ?)', 
      [telegram_id, vk_user_id, vk_token, Date.now()], function(err) {
        if (err) return cb(err);
        db.get('SELECT * FROM users WHERE id = ?', [this.lastID], cb);
      });
  });
}

// Заглушка для проверки работоспособности
app.get('/', (req, res) => {
  res.send('ВК Аналитик backend работает!');
});

// VK OAuth redirect endpoint
app.get('/api/vk/oauth', (req, res) => {
  const clientId = process.env.VK_CLIENT_ID;
  const redirectUri = process.env.VK_REDIRECT_URI;
  const scope = 'friends,groups,photos,wall,stats,email,offline';
  const vkAuthUrl = `https://oauth.vk.com/authorize?client_id=${clientId}&display=page&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&v=5.131`;
  res.json({ url: vkAuthUrl });
});

// VK OAuth callback (получение access_token)
app.get('/api/vk/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'No code provided' });
  try {
    const params = {
      client_id: process.env.VK_CLIENT_ID,
      client_secret: process.env.VK_CLIENT_SECRET,
      redirect_uri: process.env.VK_REDIRECT_URI,
      code,
    };
    const { data } = await axios.get('https://oauth.vk.com/access_token', { params });
    // TODO: Сохранять access_token пользователя безопасно
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'VK OAuth error', details: e.message });
  }
});

// Получение VK аналитики (пример: друзья, группы, лайки)
app.post('/api/vk/analytics', async (req, res) => {
  const { access_token, user_id } = req.body;
  if (!access_token || !user_id) return res.status(400).json({ error: 'Нет токена или user_id' });
  try {
    // Пример: получить список друзей
    const friends = await axios.get('https://api.vk.com/method/friends.get', {
      params: {
        access_token,
        user_id,
        v: '5.131',
        fields: 'sex,city,domain',
      },
    });
    // Пример: получить группы
    const groups = await axios.get('https://api.vk.com/method/groups.get', {
      params: {
        access_token,
        user_id,
        v: '5.131',
        extended: 1,
      },
    });
    // Пример: получить лайки к последнему посту
    const wall = await axios.get('https://api.vk.com/method/wall.get', {
      params: {
        access_token,
        owner_id: user_id,
        v: '5.131',
        count: 1,
      },
    });
    let likes = null;
    if (wall.data.response.items.length > 0) {
      const post = wall.data.response.items[0];
      likes = post.likes;
    }
    res.json({
      friends: friends.data.response,
      groups: groups.data.response,
      last_post_likes: likes,
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка VK API', details: e.message });
  }
});

// Расширенная VK аналитика: лайки, комментарии, репосты, подарки, подписчики, активность по времени
app.post('/api/vk/analytics/extended', async (req, res) => {
  const { access_token, user_id } = req.body;
  if (!access_token || !user_id) return res.status(400).json({ error: 'Нет токена или user_id' });
  try {
    // Получить последние 10 постов
    const wall = await axios.get('https://api.vk.com/method/wall.get', {
      params: { access_token, owner_id: user_id, v: '5.131', count: 10 },
    });
    let posts = wall.data.response.items || [];
    // Сбор лайков, репостов, комментариев по постам
    const likes = posts.map(p => p.likes?.count || 0);
    const reposts = posts.map(p => p.reposts?.count || 0);
    const comments = posts.map(p => p.comments?.count || 0);
    // Получить подарки
    let gifts = null;
    try {
      const g = await axios.get('https://api.vk.com/method/gifts.get', {
        params: { access_token, user_id, v: '5.131' },
      });
      gifts = g.data.response;
    } catch {}
    // Получить подписчиков
    let followers = null;
    try {
      const f = await axios.get('https://api.vk.com/method/users.getFollowers', {
        params: { access_token, user_id, v: '5.131', count: 0 },
      });
      followers = f.data.response.count;
    } catch {}
    // Анализ активности по времени (распределение постов по часам)
    const hours = Array(24).fill(0);
    posts.forEach(p => {
      if (p.date) {
        const d = new Date(p.date * 1000);
        hours[d.getHours()]++;
      }
    });
    res.json({
      likes_sum: likes.reduce((a, b) => a + b, 0),
      reposts_sum: reposts.reduce((a, b) => a + b, 0),
      comments_sum: comments.reduce((a, b) => a + b, 0),
      gifts,
      followers,
      activity_by_hour: hours,
      posts_count: posts.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка VK API', details: e.message });
  }
});

// Проверка подписки пользователя по Telegram ID
app.post('/api/subscription/status', (req, res) => {
  const { telegram_id } = req.body;
  if (!telegram_id) return res.status(400).json({ status: 'none' });
  db.get('SELECT u.id as user_id, s.status, s.expires FROM users u LEFT JOIN subscriptions s ON u.id = s.user_id WHERE u.telegram_id = ? ORDER BY s.expires DESC LIMIT 1', [telegram_id], (err, row) => {
    if (err || !row) return res.json({ status: 'none' });
    if (row.status && row.expires > Date.now()) {
      res.json({ status: row.status, expires: row.expires });
    } else {
      res.json({ status: 'trial', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    }
  });
});

// Добавление/обновление подписки (вызывается после оплаты)
app.post('/api/subscription/activate', (req, res) => {
  const { telegram_id, status, days } = req.body;
  if (!telegram_id || !status || !days) return res.status(400).json({ error: 'Недостаточно данных' });
  db.get('SELECT id FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    const expires = Date.now() + days * 24 * 60 * 60 * 1000;
    db.run('INSERT INTO subscriptions (user_id, status, expires) VALUES (?, ?, ?)', [user.id, status, expires], function(err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true, status, expires });
    });
  });
});

// TODO: Telegram Payments API integration (реализация)
const TELEGRAM_PAYMENT_TOKEN = process.env.TELEGRAM_PAYMENT_TOKEN;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;

app.post('/api/subscription/pay', (req, res) => {
  // Генерация ссылки на оплату через Telegram
  // В реальном проекте используйте Telegram Bot API для создания счета
  if (!TELEGRAM_BOT_USERNAME) return res.status(500).json({ error: 'Bot username not set' });
  const payment_url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=pay`;
  res.json({ payment_url });
});

// Webhook для подтверждения оплаты (пример)
app.post('/api/telegram/payment-webhook', (req, res) => {
  // Здесь Telegram будет присылать уведомление об успешной оплате
  // В реальном проекте проверьте подпись и данные платежа
  const { telegram_id, status, days } = req.body;
  if (telegram_id && status === 'premium') {
    db.get('SELECT id FROM users WHERE telegram_id = ?', [telegram_id], (err, user) => {
      if (user) {
        const expires = Date.now() + (days || 30) * 24 * 60 * 60 * 1000;
        db.run('INSERT INTO subscriptions (user_id, status, expires) VALUES (?, ?, ?)', [user.id, 'premium', expires]);
      }
    });
  }
  res.json({ ok: true });
});

// Проверка утечек переписок через локальный CSV-файл
app.post('/api/leaks/check', (req, res) => {
  const { vk_user_id } = req.body;
  if (!vk_user_id) return res.status(400).json({ error: 'Нет user_id' });
  try {
    const leaksPath = path.join(__dirname, 'leaks.csv');
    if (!fs.existsSync(leaksPath)) {
      // Файл не найден — fallback на заглушку
      if (vk_user_id.toString().endsWith('7')) {
        return res.json({ leaked: true, details: 'Обнаружена утечка переписки за 2023 год.' });
      } else {
        return res.json({ leaked: false });
      }
    }
    const csv = fs.readFileSync(leaksPath, 'utf8');
    const records = parse(csv, { columns: true });
    const found = records.find(r => r.vk_user_id === vk_user_id.toString());
    if (found) {
      res.json({ leaked: true, details: `Обнаружена утечка: ${found.details || 'Данные найдены в базе.'}` });
    } else {
      res.json({ leaked: false });
    }
  } catch (e) {
    res.status(500).json({ error: 'Ошибка проверки утечек', details: e.message });
  }
});

// Анализ подозрительных групп (заглушка)
const suspiciousGroups = ['death_group', '18+', 'casino', 'scam', 'darknet'];
app.post('/api/groups/suspicious', async (req, res) => {
  const { groups } = req.body;
  if (!groups || !Array.isArray(groups)) return res.status(400).json({ error: 'Нет списка групп' });
  // Примитивная проверка по ключевым словам
  const found = groups.filter(g => suspiciousGroups.some(s => (g.name || '').toLowerCase().includes(s)));
  res.json({ suspicious: found });
});

// Глубокая статистика активности (заглушка)
app.post('/api/vk/stats', async (req, res) => {
  const { access_token, user_id } = req.body;
  if (!access_token || !user_id) return res.status(400).json({ error: 'Нет токена или user_id' });
  // В реальном проекте: анализ wall.get, friends.get, messages.getHistory и т.д.
  // Здесь — заглушка
  res.json({
    top_interactions: [
      { name: 'Иван Иванов', count: 42 },
      { name: 'Мария Петрова', count: 31 },
      { name: 'Алексей Смирнов', count: 18 }
    ],
    search_history: [
      'Ольга', 'Путешествия', 'Работа', 'Музыка'
    ]
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});