# Kaiten MCP Server

MCP сервер для интеграции Kaiten API с Claude Desktop. Позволяет управлять карточками, комментариями и пространствами Kaiten напрямую из Claude.

## Возможности

- **Карточки:** Чтение, создание, обновление, удаление, поиск
- **Ответственный:** Назначение и снятие исполнителя (участник с `type: 2`), поиск карточек по человеку
- **Блокировки:** Блокер карточкой или причиной, снятие, чтение активных
- **Порядок:** Перестановка карточки относительно соседей и сортировка колонки одним вызовом
- **Массовые операции:** Перенос, срок и ответственный для списка карточек за один вызов
- **Честная пагинация:** API молча режет списки на 100 записях — инструменты дочитывают и сообщают `has_more`
- **Компактные ответы:** Карточка возвращается проекцией (7.7 КБ → 1.1 КБ), аватарки не отдаются никогда
- **Комментарии:** Полная работа с комментариями карточек
- **Контекст задачи:** Карточка, комментарии и скриншоты одним read-only инструментом
- **Вложения:** PNG/JPEG/WebP/GIF возвращаются как MCP image content
- **Пространства и доски:** Навигация по структуре Kaiten
- **Поиск:** Продвинутый поиск с фильтрами
- **Default Space:** Автоматическая работа в выбранном пространстве
- **🎛️ Verbosity Control:** Управление детализацией ответов (minimal/normal/detailed) - экономия до 90% токенов
- **📊 Response Formats:** Выбор формата вывода (json/markdown) для разных сценариев
- **🛡️ Auto-truncation:** Автоматическая защита от переполнения контекста (100k символов)
- **🧪 Evaluation Suite:** Готовые шаблоны для тестирования качества работы
- **🔒 Production-Ready:**
  - Zod validation для всех параметров
  - Автоматический retry с exponential backoff
  - Concurrency control (rate limiting)
  - LRU кеш с TTL для spaces/boards/users
  - Расширенная обработка ошибок с hints
  - Редакция токенов в логах
  - Comprehensive logging & monitoring система

## Быстрый старт

### 1. Установка

```bash
npm install
```

### 2. Настройка .env

Создайте файл `.env`:

```bash
cp .env.example .env
```

Заполните его вашими данными:

```env
KAITEN_API_URL=https://your-domain.kaiten.ru/api/latest
KAITEN_API_TOKEN=your_api_token_here
KAITEN_DEFAULT_SPACE_ID=12345  # Ваш основной space_id

# Опциональные настройки производительности (значения по умолчанию)
KAITEN_MAX_CONCURRENT_REQUESTS=5     # Макс. одновременных запросов (1-20)
KAITEN_CACHE_TTL_SECONDS=300         # Время жизни кеша в секундах (0 = выкл.)
KAITEN_REQUEST_TIMEOUT_MS=10000      # Таймаут запроса в мс (1-60000)
KAITEN_MAX_IMAGE_BYTES=8388608       # Максимум 8 МБ на изображение
KAITEN_MAX_IMAGES_PER_REQUEST=5      # Максимум 5 изображений за вызов
```

**Как получить API токен:**
1. Войдите в Kaiten
2. Откройте настройки профиля
3. Создайте новый API токен
4. Скопируйте и вставьте в `.env`

### 3. Сборка

```bash
npm run build
```

### 4. Настройка Claude Desktop

Откройте конфигурационный файл:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Добавьте (замените путь на ваш полный путь):

```json
{
  "mcpServers": {
    "kaiten": {
      "command": "node",
      "args": [
        "/полный/путь/к/MCP Kaiten/dist/index.js"
      ],
      "cwd": "/полный/путь/к/MCP Kaiten"
    }
  }
}
```

**Альтернативный способ (без .env):**

```json
{
  "mcpServers": {
    "kaiten": {
      "command": "node",
      "args": ["/полный/путь/к/MCP Kaiten/dist/index.js"],
      "env": {
        "KAITEN_API_URL": "https://your-domain.kaiten.ru/api/latest",
        "KAITEN_API_TOKEN": "your_api_token_here",
        "KAITEN_DEFAULT_SPACE_ID": "12345"
      }
    }
  }
}
```

### 5. Перезапустите Claude Desktop

Полностью закройте (⌘+Q / Alt+F4) и откройте Claude Desktop заново.

### 6. Проверка

Напишите в Claude:

```
Покажи список пространств Kaiten
```

## Доступные инструменты

### Контекст задачи и скриншоты
- `kaiten_get_task_context` - Карточка, все комментарии и скриншоты одним вызовом
- `kaiten_list_card_attachments` - Список вложений карточки и комментариев
- `kaiten_get_card_images` - Получить выбранные изображения как MCP image content

### Карточки
- `kaiten_get_card` - Получить карточку по ID **[format: json/markdown, verbose]**
- `kaiten_create_card` - Создать карточку (умеет `responsible_id`, `member_ids`, `size_text`)
- `kaiten_update_card` - Обновить карточку (умеет `size_text`, `sort_order`, `due_date: null`)
- `kaiten_delete_card` - Удалить карточку
- `kaiten_search_cards` - Поиск карточек с фильтрами **[честная пагинация, has_more]**
- `kaiten_get_space_cards` - Получить карточки пространства **[честная пагинация]**
- `kaiten_get_board_cards` - Получить карточки доски **[честная пагинация]**
- `kaiten_find_cards_by_user` - Карточки, где человек ответственный / участник / постановщик

### Связи, подзадачи
- `kaiten_add_card_child` - Подвесить карточку подзадачей к родителю
- `kaiten_remove_card_child` - Отцепить подзадачу (сама карточка не удаляется)
- `kaiten_list_card_children` - Список подзадач (компактный)

### Участники и ответственный
Ответственный (исполнитель) в Kaiten — это **участник карточки с `type: 2`**, а не `owner`.
`owner` — постановщик. Загрузка людей считается по ответственному.
- `kaiten_list_card_members` - Участники карточки с ролями
- `kaiten_set_card_responsible` - Назначить ответственного (POST + проверка + PATCH)
- `kaiten_remove_card_responsible` - Снять ответственного (только удалением из участников)
- `kaiten_add_card_member` - Добавить обычного участника
- `kaiten_remove_card_member` - Убрать участника

### Блокировки
- `kaiten_list_card_blockers` - Активные блокеры карточки (`include_released` — вся история)
- `kaiten_block_card` - Заблокировать причиной или карточкой-блокером
- `kaiten_unblock_card` - Снять блокер по **id записи блокера** (или все сразу)

### Порядок карточек
- `kaiten_set_card_order` - Поставить карточку до/после другой, в начало или конец колонки
- `kaiten_reorder_cards` - Задать порядок списку карточек одним вызовом

### Массовые операции
- `kaiten_bulk_move_cards` - Переместить список карточек в колонку/дорожку/на доску
- `kaiten_bulk_set_due_date` - Проставить или снять срок списку карточек
- `kaiten_bulk_set_responsible` - Назначить ответственного списку карточек

### Комментарии
- `kaiten_get_card_comments` - Получить комментарии карточки
- `kaiten_create_comment` - Создать комментарий
- `kaiten_update_comment` - Обновить комментарий
- `kaiten_delete_comment` - Удалить комментарий

### Пространства и доски
- `kaiten_list_spaces` - Список всех пространств
- `kaiten_get_space` - Получить пространство **[format: json/markdown]**
- `kaiten_list_boards` - Список досок **[verbosity: minimal/normal/detailed]**
- `kaiten_get_board` - Получить доску **[format: json/markdown]**
- `kaiten_update_board` - Переименовать доску (через `/spaces/{space_id}/boards/{id}`)

### Справочники (для корректных ID)
- `kaiten_list_columns` - Список колонок (статусов) доски
- `kaiten_list_lanes` - Список дорожек (lanes/swimlanes) доски
- `kaiten_list_types` - Список типов карточек доски

### Пользователи
- `kaiten_get_current_user` - Получить текущего пользователя
- `kaiten_list_users` - Список пользователей **[verbosity: minimal/normal/detailed]**

### Управление кешем и диагностика
- `kaiten_cache_invalidate_spaces` - Инвалидировать кеш пространств
- `kaiten_cache_invalidate_boards` - Инвалидировать кеш досок
- `kaiten_cache_invalidate_users` - Инвалидировать кеш пользователей
- `kaiten_cache_invalidate_all` - Инвалидировать весь кеш
- `kaiten_get_status` - Получить статус сервера (кеш, очередь, конфигурация, логирование, метрики)
- `kaiten_set_log_level` - Изменить конфигурацию логирования в runtime

## Особенности Kaiten API, которые учтены в инструментах

Всё проверено живыми запросами к `https://vibegames.kaiten.ru/api/latest` 21.09.2026 —
чтением и одноразовыми карточками, которые тут же удалялись. Дата важна: API меняется.

### Ответственный — это участник с `type: 2`, а не `owner`

`owner` — постановщик задачи, исполнитель — участник карточки с ролью 2. На карточке он
ровно один. Отчёты по загрузке людей считаются по нему, `owner_id` для этого не годится.

- `POST /cards/{id}/members {user_id, type}` **не гарантирует роль**: бывает, что запрошенный
  `type: 2` сохраняется как 1, а бывает наоборот — участник, добавленный с `type: 1` на
  карточку без ответственного, автоматически становится ответственным. Поэтому
  `kaiten_set_card_responsible` делает POST, перечитывает список и при необходимости чинит
  ролью через `PATCH /cards/{id}/members/{userId}`.
- **Понизить ответственного до обычного участника нельзя**: `PATCH` с `type: 1` отвечает
  `400 Member.type should be >= 2`. Снять роль можно только удалив человека из участников —
  это и делает `kaiten_remove_card_responsible`.
- При назначении нового ответственного прежний понижается сам. Инструмент возвращает его в
  поле `demoted`, а явного PATCH на понижение не делает.
- Если у пользователя нет доступа к пространству, POST отвечает
  `400 space.card.update permission is required`.

### Списки молча обрезаются на 100 записях

`GET /cards?board_id=X&limit=300` отвечает `200 OK` и отдаёт 100 карточек. Никакого признака,
что что-то осталось за кадром, в ответе нет — ни заголовка с общим количеством, ни флага.
Доска на 312 карточек выглядит как доска на 100.

Все списочные инструменты страницуются сами (`offset`/`skip`, страницами по 100) и всегда
печатают честный футер: `Returned N of M requested. has_more: true|false` и `next_offset`.
Запрашивается на одну строку больше нужного — только так `has_more` становится фактом, а не
догадкой. То же самое у `/users`: `limit=200` отдаёт 100.

### Оценка пишется только через `size_text`

`size` и `size_unit` при записи игнорируются — PATCH отвечает `200`, в карточке остаётся
`null`. Пишется только `size_text` в формате `"8 ч"`, и он сам заполняет `size: 8` и
`size_unit: "ч"`. Инструменты принимают `size_text`, перечитывают ответ и, если значение не
записалось, кладут это в `warnings` вместо молчаливого успеха.

### `state` выводится из типа колонки

`PATCH {state: 3}` на карточке в колонке-очереди отвечает `200` и не меняет ничего. «Сделано»
= перенос в колонку с `type: 3` (`kaiten_list_columns` показывает тип: 1 — очередь,
2 — в работе, 3 — готово). `column_id` и `state` в одном вызове работают, если тип совпадает;
несовпадение попадает в `warnings`.

Отдельное правило: **срок завершённой карточки менять нельзя** —
`400 It is currently not allowed to change a due date of completed cards`. Сначала срок, потом
перенос в Done.

### Блокеры — это отдельные записи со своим id

Два вида: карточкой (`POST /cards/{id}/blockers {blocker_card_id}`) и текстовой причиной
(`{reason}`). Снятие — `DELETE /cards/{id}/blockers/{blockerRecordId}`, где id **записи
блокера**, а не карточки. Запись не удаляется, а помечается `released: true`, поэтому
`GET /cards/{id}/blockers` отдаёт всю историю — `kaiten_list_card_blockers` по умолчанию
показывает только активные. Если карточка-блокер недоступна токену, ответ —
`403 User with id N dont have access to blocker card with id M`.

### Порядок карточек — это float `sort_order`

Колонка сортируется по `sort_order` по возрастанию. `sort_by=sort_order` в запросе **не
работает** (порядок ответа не меняется), поэтому сортировка делается на клиенте.
`kaiten_set_card_order` читает колонку и вычисляет значение между соседями;
`kaiten_reorder_cards` по умолчанию переиспользует уже занятые карточками позиции, чтобы не
перепрыгнуть через карточки, которых нет в списке. Одинаковые `sort_order` у соседей
встречаются — тогда точная вставка невозможна, и это пишется в `warnings`.

### Несимметричные пути

| Операция | Путь | Через «логичный» путь |
|---|---|---|
| Карточки доски | `GET /cards?board_id={id}` | `GET /boards/{id}/cards` → **404** |
| Переименование доски | `PATCH /spaces/{spaceId}/boards/{id}` | `PATCH /boards/{id}` → 404 |
| Удаление колонки | `DELETE /boards/{id}/columns/{id}` | через пространство → 404 |
| Чтение доски | `GET /boards/{id}` | — |

`GET /boards/{id}/cards` → 404 проверен на трёх досках; `kaiten_get_board_cards` ходит через
`/cards`. Пути для переименования доски и удаления колонки взяты со слов заказчика: первый
реализован в `kaiten_update_board`, но **живой PATCH не проверялся** (это была бы правка чужой
доски); удаления колонки в инструментах нет.

### `due_date: null` проходит, `owner_id: null` — нет

Срок снимается передачей `null`. Владельца снять нельзя в принципе:
`400 Card.owner_id should be integer`, только переназначить.

### Размер ответа: карточка приходит проекцией

Сырая карточка — от 7 КБ (`PATCH`-ответ) до 77 КБ (`GET /cards/{id}` с подзадачами). Основной
объём — base64-аватарки (≈2 КБ на человека, повторяются у owner, у каждого участника и у
участников каждой подзадачи), целиком вложенные объекты `children` и `parents`, `path_data` и
полсотни служебных полей.

Все инструменты отдают компактную проекцию: id, title, url, board/column/lane (id + title),
state, due_date, size_text, owner, responsible, members с ролями, blocked, счётчики
parents/children. `verbose: true` возвращает полный объект — **но аватарки вырезаются всегда,
в любом режиме**. Массовые операции отдают ещё более короткую форму (одна строка на карточку).

Замеры на живом API 21.09.2026:

| Вызов | Было | Стало |
|---|---|---|
| `kaiten_update_card` (карточка с 1 участником) | 7 698 байт | 1 129 байт |
| `kaiten_get_card` (`format: json`, 6 подзадач) | 77 120 байт | 1 551 байт |
| `kaiten_bulk_move_cards` на 3 карточки | ~23 000 байт (3 отдельных вызова) | 1 100 байт |
| `kaiten_get_board` (доска на 43 карточки) | 3 147 340 байт | 918 байт |
| `kaiten_get_current_user` | 19 052 байта | 188 байт |

### Retry

`axios-retry` настроен на 3 попытки с экспоненциальным бэкоффом и джиттером для сетевых
ошибок, `429`, `408` и `5xx` — для **всех** методов, включая POST и PATCH (у них уходит
заголовок `Idempotency-Key`, так что повтор не создаёт дубль). `404` и `400` не повторяются.

## Примеры использования

### Базовые операции

```
Покажи карточку 789
```

```
Создай карточку "Исправить баг" на доске 456 с описанием "Проблема с авторизацией"
```

```
Обнови карточку 789: измени статус на 3
```

```
Добавь комментарий к карточке 789: "Работа завершена"
```

### Verbosity Control - Экономия токенов

**Minimal** - Ультра-компактный формат (90% экономия):
```
Найди карточки на доске 456 с minimal verbosity
# Вывод: 1. [12345] Fix bug
#        2. [12346] Add feature
```

**Normal** - Сбалансированный (по умолчанию, 80% экономия):
```
Найди карточки на доске 456
# Вывод: полная информация с owner, board, статусом, URL
```

**Detailed** - Полный API response:
```
Найди карточки на доске 456 с detailed verbosity
# Вывод: все метаданные, permissions, внутренние поля
```

**Когда использовать:**
- `minimal` - Быстрый поиск, получение ID, краткие списки
- `normal` - Работа с карточками, обычные задачи (по умолчанию)
- `detailed` - Отладка, интеграции, нужны все поля

### Response Format Control

**Markdown** - Человеко-читаемый (по умолчанию):
```
Покажи карточку 12345
# Вывод: # Card Title
#        🔗 https://...
#        📋 Board: ...
```

**JSON** - Структурированные данные:
```
Покажи карточку 12345 в JSON формате
# Вывод: {"id": 12345, "title": "...", ...}
```

**Когда использовать:**
- `markdown` - Показ пользователю, презентация (по умолчанию)
- `json` - Интеграции, программная обработка, парсинг

### Поиск

```
Найди карточки со словом "авторизация" на доске 456
```

```
Покажи мои карточки в пространстве 123
```

```
Найди все карточки в работе на доске 456
```

### Default Space

По умолчанию все операции выполняются в пространстве, указанном в `KAITEN_DEFAULT_SPACE_ID`. Это делает команды короче:

```
Найди карточку про Болгарию
# Автоматически ищет в DEFAULT_SPACE_ID
```

Для поиска во всех пространствах явно укажите:

```
Найди карточку про Болгарию во ВСЕХ пространствах
```

**Как работает Default Space:**
- Все card-операции автоматически используют `KAITEN_DEFAULT_SPACE_ID`
- Для поиска в других пространствах укажите `space_id` явно
- Для поиска везде явно попросите "во всех пространствах"

## Оптимизация и производительность

### ✅ Лучшие практики поиска

**DO (Делайте так):**

```
Найди карточки "баг" на доске 456
```

**DON'T (Не делайте так):**

```
Покажи все карточки пространства и найди среди них "баг"
```

### Параметры поиска

- `limit` - количество карточек (по умолчанию 10)
- `sort_by` - сортировка: `created`, `updated`, `title`
- `sort_direction` - направление: `asc`, `desc`
- `condition` - 1=активные (по умолчанию), 2=архивные

### Примеры с параметрами

```
Найди 20 карточек на доске 456
```

```
Покажи архивные карточки на доске 456
```

```
Найди карточки на доске 456, отсортированные по дате обновления
```

## Структура проекта

```
MCP Kaiten/
├── src/
│   ├── index.ts          # MCP сервер
│   ├── kaiten-client.ts  # Kaiten API клиент
│   ├── config.ts         # Конфигурация и валидация
│   ├── cache.ts          # LRU кеш
│   ├── schemas.ts        # Zod схемы валидации
│   ├── card-view.ts      # Компактная проекция карточки (без аватарок)
│   ├── card-ops.ts       # Ответственный, порядок, массовые операции, поиск по человеку
│   ├── utils.ts          # Utility functions (11 helpers)
│   ├── *.test.ts         # Юнит-тесты (node --test, fetch/адаптер замокан)
│   ├── logging/          # Система логирования
│   │   ├── index.ts      # Экспорты
│   │   ├── types.ts      # TypeScript типы
│   │   ├── logger.ts     # Unified logger (singleton)
│   │   ├── file-logger.ts    # Pino file logger
│   │   ├── mcp-logger.ts     # MCP notifications logger
│   │   └── metrics.ts        # Performance metrics collector
│   └── middleware/       # HTTP middleware
│       └── logging-middleware.ts  # Axios logging interceptor
├── evaluations/          # Evaluation suite
│   ├── README.md         # Руководство по evaluations
│   └── kaiten-eval-template.xml  # Шаблон с 10 вопросами
├── logs/                 # Файлы логов (в .gitignore)
├── dist/                 # Скомпилированные файлы
├── .env                  # Конфигурация (не в git)
├── .env.example          # Пример конфигурации
├── tsconfig.json         # TypeScript конфигурация
├── package.json
├── README.md             # Этот файл
├── CHANGELOG.md          # История изменений
└── CLAUDE.md             # Инструкции для Claude Code
```

## Возможности карточек

При получении карточки возвращаются следующие поля:

```json
{
  "id": 12345,
  "title": "Название карточки",
  "url": "https://your-domain.kaiten.ru/space/12345/card/12345",
  "description": "Полное описание...",
  "created": "2025-07-23T07:55:52.934Z",
  "updated": "2025-10-01T12:14:47.754Z",
  "state": 2,
  "owner_id": 67890,
  "owner_name": "Иван Иванов",
  "board_id": 54321,
  "board_title": "Project Board",
  "blocked": true,
  "block_reason": "Ожидание данных от команды",
  "blocked_at": "2025-08-04T09:10:22.528Z",
  "blocker_name": "Иван Иванов",
  "archived": false,
  "tags": ["важно", "срочно"],
  "members": ["Иван Иванов", "Мария Петрова"],
  "due_date": "2025-10-19T00:00:00.000Z"
}
```

## Устранение неполадок

### Сервер не подключается

1. Проверьте правильность пути в конфигурации Claude
2. Убедитесь, что проект собран: `npm run build`
3. Проверьте `.env` файл
4. Перезапустите Claude Desktop полностью (⌘+Q)

### Ошибки API

- Проверьте, что токен действителен
- URL должен заканчиваться на `/api/latest`
- Проверьте права доступа токена в настройках Kaiten

### Ошибка "Tool result is too large"

Используйте фильтры и параметр `board_id`:

```
# Плохо
Найди карточки в пространстве 123

# Хорошо
Найди карточки на доске 456 в пространстве 123
```

### Отладка

**Продвинутое логирование**

Сервер поддерживает гибкую систему логирования для отладки и мониторинга. Все настройки логирования можно контролировать через переменные окружения или в runtime с помощью инструмента `kaiten_set_log_level`.

#### Переменные окружения (опционально):

```env
# Включить/выключить логирование (по умолчанию: true)
KAITEN_LOG_ENABLED=true

# Уровень логирования (по умолчанию: error)
# debug | info | notice | warning | error | critical | alert | emergency
KAITEN_LOG_LEVEL=error

# Отправлять логи в MCP клиент (по умолчанию: false)
KAITEN_LOG_MCP_ENABLED=false

# Записывать логи в файл (по умолчанию: false)
KAITEN_LOG_FILE_ENABLED=false

# Путь к файлу логов (по умолчанию: ./logs/kaiten-mcp.log)
KAITEN_LOG_FILE_PATH=./logs/kaiten-mcp.log

# Логировать все HTTP запросы (по умолчанию: false)
KAITEN_LOG_REQUESTS=false

# Собирать метрики производительности (по умолчанию: false)
KAITEN_LOG_METRICS=false
```

#### Готовые профили:

**Production (минимальное логирование):**
```env
KAITEN_LOG_LEVEL=error
KAITEN_LOG_FILE_ENABLED=false
KAITEN_LOG_REQUESTS=false
KAITEN_LOG_METRICS=false
```

**Development (умеренное логирование для отладки):**
```env
KAITEN_LOG_LEVEL=info
KAITEN_LOG_FILE_ENABLED=true
KAITEN_LOG_REQUESTS=false
KAITEN_LOG_METRICS=true
```

**Debug (полное логирование для глубокого анализа):**
```env
KAITEN_LOG_LEVEL=debug
KAITEN_LOG_MCP_ENABLED=true
KAITEN_LOG_FILE_ENABLED=true
KAITEN_LOG_REQUESTS=true
KAITEN_LOG_METRICS=true
```

#### Runtime управление логированием:

Используйте инструмент `kaiten_set_log_level` для изменения конфигурации без перезапуска:

```
# Включить debug режим
Установи уровень логирования debug с файлами и метриками

# Выключить всё логирование
Установи уровень логирования off

# Включить только метрики производительности
Установи уровень логирования info с метриками
```

#### Просмотр логов:

Логи сервера выводятся в stderr. На macOS/Linux их можно посмотреть через Console.app или запустив Claude из терминала. Файловые логи находятся в директории `logs/` в формате JSON (для дальнейшего анализа).

#### Метрики производительности:

При включенных метриках (`KAITEN_LOG_METRICS=true`) используйте `kaiten_get_status` для просмотра:

```
Покажи статус сервера
```

Метрики включают:
- Общее количество запросов
- Агрегированная статистика по инструментам (latency, success rate, cache hit rate)
- Последние 100 запросов с деталями

## Технические детали

- **Node.js:** Версия 20 или выше (требование `engines`)
- **TypeScript:** 5.0+
- **MCP SDK:** @modelcontextprotocol/sdk v1.30.0+
- **API Client:** axios с retry/backoff и AbortSignal support
- **Размер:** ~600 строк TypeScript, 25KB скомпилированного кода

### Безопасная настройка для Codex

Для анализа задач без изменения Kaiten используйте allowlist в `~/.codex/config.toml`:

```toml
[mcp_servers.kaiten]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/kaiten-mcp-server/dist/index.js"]
cwd = "/absolute/path/to/kaiten-mcp-server"
enabled = true
enabled_tools = [
  "kaiten_get_task_context",
  "kaiten_get_card",
  "kaiten_get_card_comments",
  "kaiten_search_cards",
  "kaiten_list_card_attachments",
  "kaiten_get_card_images",
]
default_tools_approval_mode = "prompt"
```

Поддерживаются только HTTPS-ссылки без localhost и private-network адресов.

### MCP I/O Protocol

**Критично для отладки:** MCP использует stdio-транспорт для общения между клиентом и сервером.

- **stdout** — только JSON-RPC протокольные сообщения (чистый канал связи)
- **stderr** — все логи, дебаг-информация, ошибки

**Важно:**
- Любой `console.log()` в коде нарушает протокол → используйте `console.error()` для логов
- Этот сервер гарантирует чистоту stdout через `safeLog` wrapper (src/config.ts:126-152)
- При отладке смотрите stderr: `node dist/index.js 2>debug.log` или используйте MCP Inspector

Подробнее: [Build an MCP server](https://modelcontextprotocol.io/docs/getting-started/build-an-mcp-server)

## Лицензия

MIT

## Документация

- **[CHANGELOG.md](./CHANGELOG.md)** - История изменений
- **[CLAUDE.md](./CLAUDE.md)** - Инструкции для Claude Code разработки
- **[evaluations/README.md](./evaluations/README.md)** - Руководство по evaluation suite
- **[Kaiten API Docs](https://developers.kaiten.ru/)** - Официальная документация API
