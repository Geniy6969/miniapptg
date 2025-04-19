# ВК Аналитик

Мини-приложение для Telegram с функционалом, аналогичным приложению Редфлаг.

## Стек
- Backend: Node.js (Express)
- Frontend: React (PWA, Telegram WebApp)

## Основные функции
- Аналитика активности VK (лайки, комментарии, друзья, группы и т.д.)
- Система подписки (тарифы, пробный период)
- Интеграция с Telegram API

## Запуск
1. Установите зависимости backend: `npm install`
2. Запустите backend: `node server.js`
3. Установите зависимости frontend: `cd frontend && npm install --legacy-peer-deps`
4. Запустите frontend: `cd frontend && npm start`

## TODO
- Реализовать VK API интеграцию
- Добавить Telegram WebApp авторизацию
- Реализовать систему подписки

# Serveo (быстрый бесплатный туннель для Telegram WebApp)

## Как использовать Serveo для теста Telegram WebApp

1. Убедитесь, что ваш frontend запущен на http://localhost:3000 (npm start в папке frontend).
2. Откройте терминал (PowerShell, CMD или Git Bash).
3. Выполните команду:

    ssh -R 80:localhost:3000 serveo.net

4. После запуска появится строка вида:

    Forwarding HTTP traffic from https://yourname.serveo.net

5. Используйте этот адрес для интеграции с Telegram WebApp:
   - Укажите его в настройках бота через @BotFather (команда /setdomain).
   - Используйте его в web_app кнопке Telegram-бота.

6. Откройте бота в Telegram, нажмите кнопку — приложение откроется внутри Telegram.

---

**Примечание:**
- Для работы serveo нужен установленный ssh-клиент (есть в Windows 10/11 или в Git Bash).
- Serveo не требует регистрации и полностью бесплатен.
- Если порт 80 занят, можно использовать другой порт: ssh -R 8080:localhost:3000 serveo.net

---

**Пример кнопки для Telegram-бота:**

```
{
  "reply_markup": {
    "inline_keyboard": [
      [
        {
          "text": "Открыть ВК Аналитик",
          "web_app": { "url": "https://yourname.serveo.net" }
        }
      ]
    ]
  }
}
```
