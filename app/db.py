"""SQLite 数据访问层。

选型理由（见计划文件）：这个规模（2-10 人）SQLite 最合适——几乎零常驻内存、
免运维。用 WAL 模式支持并发读写。

所有时间戳统一用 UTC 秒（INTEGER），便于排序与增量同步。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Iterable, Sequence

import aiosqlite

from .config import settings

log = logging.getLogger("lifeguard.db")

SCHEMA = """
-- ★ 2026-10-08：**用户表从"按需镜像"变成"权威"** ✗→✓（合并那次）。
--
--   原来是两张 users：壳那张是权威（注册/改名的都在它那儿 ✓），
--   这张是**按需镜像** —— 第一次见到谁补一条 ✓，`password_hash` 写死 `!`，
--   昵称/头像靠 `ensure_user(..., authoritative=True)` 从壳那边抄过来 ✓。
--   合并之后"壳"没有了 ✓，这张表就是唯一的那一张 ✓：
--   `password_hash` 是真的（**两种格式都认**，见 `auth.verify_password_any`），
--   `is_admin` 也从壳那边搬了过来 ✓。
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    nickname      TEXT    NOT NULL,
    avatar        TEXT,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);

-- ★ 2026-10-08：`uuid` 从壳的 `workspaces.uuid` 搬过来 ✓（8 位 hex ✓）。
--
--   它和 `profile`（`chat-<uuid>` ✓）是**同一个东西的两种写法** ✓ ——
--   所以这里**不再单独加唯一约束** ✗：真正的唯一性是
--   `_ensure_profile_unique()` 按 `profile` 建的那个索引 ✓，
--   uuid 的唯一性由它推出来 ✓（两处都建 = 两处都要维护 ✓）。
--   老行（合并之前建的）这一列是空的 ✓ —— 迁移脚本会按 profile 回填 ✓。
CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT,
    name        TEXT    NOT NULL,
    -- ★ 2026-10-08：**正在退出**的时间戳（NULL = 正常 ✓）。
    --   用途：退出空间是"先标记、后真删"两段（见 `routes_shell.leave_space` ✓）——
    --   标记一落，这个空间就该**立刻对它的人不可用** ✓，
    --   不等那个 root worker 删完 profile ✓。
    --   拦在 **`require_member`** 那一处 ✓（所有群数据的唯一入口 ✓）：
    --   一处拦住 = 每条路都拦住了 ✓；散在十几个接口里迟早漏一个 ✗。
    deleting_at INTEGER,
    owner_id    INTEGER NOT NULL REFERENCES users(id),
    invite_code TEXT    NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role      TEXT    NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    -- ★ 2026-10-08：**每个人自己写的一段自我介绍**（≤500 字 ✓，可空 ✓）。
    --   用途只有一个：每轮拼进 `_group_persona` ✓ —— 让他从第一天起就
    --   知道"这两个人是谁" ✓，而不是靠聊天一点点猜 ✓。
    --   ⚠️ 它是 (人, 空间) 的 ✓，不是账号级的 ✗ —— 一人一空间之后两者等价 ✓，
    --      但存法按语义走 ✓（空间没了它就该跟着没 ✓）。
    self_intro TEXT,
    PRIMARY KEY (group_id, user_id)
);

-- ★ 2026-10-08：**备注** ✓ —— 你给别人起的名字 ✓。
--
--   用户定的一句话说清了它和"昵称"的区别：「备注后群聊里显示就会替换为备注内容，
--   **对方不感知**」✓。
--
--   ⚠️ 所以它**不进给模型的 prompt** ✗（见 `_group_persona` ✓）——
--      备注是"我私下怎么叫他" ✓，一旦进 prompt，管家完全可能当众说出来 ✓
--      （"你备注里管他叫老王" ✓），那就正好违反了"对方不感知" ✓。
--   ⚠️ 它也是 **(我, 他)** 的关系 ✓，不是 (人, 空间) 的 ✗ ——
--      同一个人对不同人有不同备注 ✓，而且**只该我看得见** ✓
--      → 独立一张表 ✓（塞进 `group_members` 会变成"大家共用一个备注" ✗）。
CREATE TABLE IF NOT EXISTS contact_notes (
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note       TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, peer_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id   INTEGER,                 -- NULL 表示 agent
    sender_type TEXT    NOT NULL,        -- 'user' | 'agent' | 'system'
    msg_type    TEXT    NOT NULL,        -- 'text' | 'image' | 'voice'
    content     TEXT,                    -- 文本内容 / 语音转写
    media_path  TEXT,                    -- 相对 media_dir 的路径
    media_meta  TEXT,                    -- JSON：时长、宽高、原始文件名等
    mentions    TEXT,                    -- JSON 数组，如 ["agent","17"]
    reply_to    INTEGER REFERENCES messages(id),
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, id);


-- ⚠️ 2026-10-11：`group_memory` 和 `ledger_entries` 的**建表语句删了** ✓
--   （数据还在库里 —— 只删 DDL、不 DROP ✓；它们早就没人读写 ✓）。
-- ── 泛用的结构化记录（取代了专用的 ledger_entries）────────────────────
--
-- 形状是 `kind + fields(JSON)`：一张表承载所有"要能查、能算、能画图"的东西。
-- 记账只是其中一个 kind（bookkeeping），以后加待办、纪念日、健康记录都不用改表。
--
-- 为什么要泛用而不是一任务一张表：**可视化层要能泛化**。按 (kind, fields) 渲染，
-- 一套代码画所有类型；每种任务单独建表的话，每加一种就得给可视化写个特例。
--
-- 代价与对策：JSON 字段没有类型约束，写入会脏。所以配套一张 `record_kinds`
-- 登记表——写入时按登记的 schema 校验（见 app/records.py）。**校验必须在我们这边做**，
-- 让模型只负责填值。
CREATE TABLE IF NOT EXISTS records (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    fields     TEXT    NOT NULL,          -- JSON 对象
    created_by INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_group ON records(group_id, kind, id DESC);

-- 改/删的留痕。**每改一次，先把「改之前」的样子存这儿。**
--
-- 为什么要留痕而不是直接覆盖：账目是"钱的事"，用户一定会问
-- "这笔原来记的是多少"。覆盖了就永远答不上来。
-- 而且这样才有"撤销"的余地——最上面的那条就是上一次的样子。
CREATE TABLE IF NOT EXISTS record_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id  INTEGER NOT NULL,
    group_id   INTEGER NOT NULL,
    action     TEXT    NOT NULL,          -- update / delete / restore
    fields     TEXT    NOT NULL,          -- 改**之前**的那份 JSON
    changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rechist_record ON record_history(record_id, id DESC);

-- 类型登记：这个群有哪些 kind、各自的字段定义。
--
-- **约束：只能往宽长。** 新类型随便建（零摩擦），已有类型可以加字段，
-- 但**不能改/删已有字段**——那会破坏历史数据、让可视化对不上。
-- 这条不变量由 app/records.py 的 define_kind 强制。
CREATE TABLE IF NOT EXISTS record_kinds (
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL,
    schema     TEXT    NOT NULL,          -- JSON：{fields: {...}, summary: {...}}
    created_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, kind)
);

-- 提醒。**放在我们这边，不用 Hermes 内部 cron。**
--
-- 原因是一次真实事故：agent 自己用 Hermes cron 建了个"每晚10点记账提醒"，
-- 任务每晚真的跑、真的调工具、真的生成一段话——**然后输出被丢进虚空**，
-- 因为那套 cron 的投递配置是 `deliver: origin` 而 `origin: null`，
-- 而且它连错都不报（`last_status: ok`）。agent 因为记忆里写着"已设置定时任务"
-- 就一直以为办妥了，用户则一直没收到。
--
-- 教训：提醒是**业务功能**，该由业务系统持有——可查、可取消、失败会出现在我们日志里。
CREATE TABLE IF NOT EXISTS reminders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    text          TEXT    NOT NULL,      -- 要提醒什么（给 agent 的指令，不是最终文案）
    fire_at       INTEGER NOT NULL,      -- 下次触发时间（unix 秒）
    repeat_daily  INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    last_fired_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(enabled, fire_at);


-- ── 创意工坊：用户做的组件 ──────────────────────────────────────────────
--
-- ★ **状态和版本在这里，不在文件里** ✗→✓ —— 2026-10-07 定的。
--   文件（`var/components/g<群号>/<slug>/v<N>/`）只放**内容** ✓；
--   "这一版是实验还是正式"由服务端持有 ✓。
--
--   为什么非这样不可：`meta.json` 是 **agent 自己填的** ✓。
--   状态放那儿，它写一次 `"state":"live"` 就把组件直接送进正式区 ✓，
--   而"用户在工坊里点确认才转正"当场失效 ✗。
--
-- 三态：`draft`（做完还没启用）/ `live`（正在用）/ `archived`（被新版顶下来的旧正式版）。
-- ⚠️ 第三个不能省 ✗ —— 少了它，"旧的留着不删"这句话没地方放 ✓。
--
-- ⚠️ **部分唯一索引是最后一道，也是唯一一道绕不过的** ✓ ——
--    "同一个组件只能有一个正式版"靠它 ✓，不靠代码里记得先 archive 旧的 ✓
--    （和 `groups.profile` 那个唯一索引同一手法 ✓）。
CREATE TABLE IF NOT EXISTS components (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,          -- 英文短名，也是目录名（中文名会带来编码的麻烦）
    version    INTEGER NOT NULL,          -- 第几版，**服务端自增**，不接受 agent 传
    state      TEXT    NOT NULL,          -- draft | live | archived
    title      TEXT,
    icon       TEXT,
    data_json  TEXT,                      -- meta.json 里那份 data 声明
    note       TEXT,                      -- NOTE.md 的正文（头部由服务端拼）
    created_at INTEGER NOT NULL,
    enabled_at INTEGER,                   -- 什么时候转正的
    enabled_by INTEGER,                   -- 谁点的（2-10 人的群里，这个信息有用）
    -- ★ 是**哪个任务**做出来的（2026-10-07 ✓）。
    --   用途只有一个："继续改这个组件"要回到**当初那条对话** ✓。
    --   ⚠️ 允许为空 ✓ —— 迁移前的老组件补不出来 ✓，而且插件拿不到任务号时
    --   也要能照常落地 ✓。"链接断了"是**降级**（回到一条新对话），不是故障 ✓。
    task_id    INTEGER,
    -- ★ 这一版**在"组件容纳界面"里怎么展示**（2026-10-07 晚上 ✓）——
    --   用户定的：「每次组件创意时，都要问的一件事是如何在组件容纳界面展示，
    --   可以传统的上面图标下面名称，也可以其他」✓。
    --   形状：`{"kind":"tile","w":1,"h":1,"tint":"#22334d"}` ✓（见 main.py 的 _spot_of）
    --   ⚠️ **它属于"这一版"** ✓ —— 是**组件设计的一部分** ✓（跟 icon 一样 ✓），
    --      所以它随版本走 ✓；而"摆在哪个格子"是用户的事 ✓，在 `component_spots` ✓。
    spot_json  TEXT,
    UNIQUE(group_id, slug, version)
);

-- ★ 组件在"容纳界面"里**摆在哪**（2026-10-07 晚上 ✓）。
--
-- 为什么**不在 `components` 上放一列** ✗→✓：`components` 是**按版本**的 ✓
-- （一个 slug 好几行 ✓），而"放在第几个格子"是**这个东西**的属性 ✓ ——
-- 放版本上的话，"改了一版"会把位置也带得乱跑 ✓，而且读的时候还得挑一行 ✓
-- （写在哪一行？读哪一行？两处都能出岔 ✓）。
--
-- ⚠️ 它**不是外键** ✓ —— `slug` 在 `components` 里没有单行的对应（一 slug 多行 ✓）。
--    删组件时**要记得一起删** ✓（`main.py` 的 `component_delete` ✓）。
CREATE TABLE IF NOT EXISTS component_spots (
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    pos        INTEGER NOT NULL,          -- 第几个格子，小的在前
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_components_group
    ON components(group_id, state, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_components_one_live
    ON components(group_id, slug) WHERE state = 'live';

-- 「做组件」那张一次性票。**它是硬校验①的全部依据** ✓ ——
-- 用户在工作坊里确认细节之前，**世界上不存在任何可用的票** ✓；
-- 写入组件必须带票 ✓，票只能用一次 ✓、30 分钟过期 ✓。
--
-- ⚠️ **必须落库，不能放内存** ✗→✓ —— agent 手里有 `restart_backend` 工具 ✓
--    而且它会用 ✓。内存里的票会被它自己重启掉 ✓，症状是
--    "用户确认了、子代理也写完了，却被拒" ✓ —— 而**两边都不知道为什么** ✓。
--
-- ⚠️ `group_id` 在这张表里不是多余的 ✗→✓：`component_save` 的群号
--    **从票反查** ✓，不从会话标识推 ✓ —— 因为真正动手写文件的是**子代理** ✓，
--    而子代理的会话标识里**没有群号** ✓（见 2026-10-07 那条实测）。
CREATE TABLE IF NOT EXISTS component_tickets (
    token      TEXT PRIMARY KEY,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    slug       TEXT    NOT NULL,
    brief      TEXT,                      -- 用户确认下来的那句需求（子代理的 brief 就靠它）
    handle     TEXT,                      -- 暂存文件的绝对路径（子代理往那儿写）
    created_at INTEGER NOT NULL,
    used_at    INTEGER,                   -- 用过一次就填上，**再用就拒**
    expires_at INTEGER NOT NULL,
    -- ★ 是哪条对话派出去的这张票（2026-10-07 ✓）。
    --   用途只有一个：**用户切走的时候按它作废** ✓ —— "切换 = 终止"里
    --   唯一能由我们持久保证的一半 ✓（见 `routes_workshop.py` 那段 ✓）。
    task_id    INTEGER
);

-- 创意工坊的对话。**和群聊消息是两张表** ✗→✓ —— 2026-10-07。
--
-- 为什么不给 `messages` 加一列 `channel` ✗：那张表的 `_SELECT` 是唯一列清单 ✓，
-- 而 WHERE 有**五处** ✓ —— 加列就要改五处 ✓，**漏一处工坊的话就漏进群聊历史** ✗。
-- 而"不进群聊"本来只要 `broadcast=False` 就够了 ✓（见 messages.py ✓）；
-- 列只为"重连、翻历史不串"服务 ✓ —— 不值那个风险 ✓。
--
-- ⚠️ **按 `user_id` 分开** ✓ —— 工坊的会话是**每用户一条** ✓
--    （两个人同时进工坊不会互相串话 ✓，见 `diy_session_id_for` ✓）。
--
-- ★ 2026-10-07：**钥匙从 `slug` 换成了 `task_id`** ✗→✓。
--
--   为什么换：`slug` 要到流程第 ③ 步（用户确认）才由 agent 定下来 ✓，
--   而"＋做一个新的"在那之前就得有身份 ✗ —— 于是两次"新的"slug 都是空 ✓，
--   两条对话**在界面上也混在一起** ✗；更糟的是 Hermes 那边的会话是按人分的 ✗，
--   同一个人做 A 再做 B，**它脑子里是同一段上下文** ✗。
--
--   ⚠️ `slug` **是死列了，但留着不删** ✓ —— 和 `groups` 那四列同一个理由
--      （见 `_migrate_agent_status` 那段 ✓）：SQLite 删列要重建整张表 ✓，
--      风险不值当 ✓。而且它还有最后一个用处：**迁移时按它把老消息分堆** ✓。
--      代码里从此一个引用都不留 ✓（"同一份数据两处 = 迟早走岔" ✓）。
CREATE TABLE IF NOT EXISTS workshop_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL,          -- 谁的对话（Hermes 会话也按它分）
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,          -- 最近动过：既排"上次那个"，也排切换列表
    -- ★ 用户**开做时给它起的名字**（2026-10-07 晚上 ✓）—— 用户定的：
    --   「点击后会提示命名，后续也可以在右上角的组件管理界面重命名」✓。
    --   用处：① 导航那一列上有个说得出口的名字 ✓（不然是一串"还没起名"✓）
    --        ② 传给 `diy_persona` ✓ —— 它定名前先知道用户想叫它什么 ✓
    --        ③ `component_save` 落成时**以它为准** ✓（用户起的名字优先 ✓）
    --   ⚠️ 组件真正落地之后，名字以 `components.title` 为准 ✓（那个是能改的、
    --      而且改一处同步所有地方 ✓，见 `main.py` 的 `component_rename` ✓）。
    title      TEXT,
    -- ★ ★ 2026-10-07 深夜：「固化 / 未固化」**整套去掉了** ✗→✓（用户定的 ✓）——
    --   「组件聊天没有所谓的固化和非固化概念了，只要新建了组件，就会进入一个对话」✓。
    --   `components.state` 那一列**留着不动** ✓（它现在只服务内部：
    --   哪一版是最新的 ✓、旧版归档 ✓），但**界面上一个字都不再提** ✓，
    --   "未固化最多 3 个"那条额度也跟着废了 ✓（概念没了，它就没法表达了 ✓）。
    --
    -- ★ **在等子代理交付**（2026-10-07 深夜 ✓）—— 记的是"从哪一刻开始等的" ✓；
    --   落成了就清空 ✓。
    --   ⚠️ **必须落库，不能只放内存** ✗→✓ —— 用户实测踩到的：他在 21:27 派了子代理 ✓、
    --      我 21:30 部署重启了一次 ✓ → 内存里那份登记**没了** ✓ →
    --      "做好了"再也没人替他问 ✓（他得自己说一句"还没好吗"✦）。
    --      而**"他做组件的时候我正好在部署"是最常发生的一种** ✓。
    --   用处只有一个：服务起来时**把还欠着的那些捡回来** ✓（见 `poke_loop` ✓）。
    awaiting   INTEGER,
    -- 这条对话是**冲着哪个组件**去的（可以还不知道 ✓）。
    --   · 从「继续改这个组件」开的，一上来就填上 ✓
    --   · "＋做一个新的"开的，等 agent 在 `component_save` 时定了名再填 ✓
    -- ⚠️ 它**不是** `components` 的外键 ✓ —— 定名之前那个 slug 还不存在任何行 ✓。
    --    它的用处是两件事：① `diy_persona` 从第一轮就知道"这次是动它" ✓
    --    ② （原来还有一条：计"未固化"额度时好分清两种对话 ✓ —— 那道闸
    --        2026-10-07 深夜跟着"固化"整套撤了 ✓，这条用途也就没了 ✓）
    --       —— 不然改一个已保留的组件会白占一个名额 ✓（那是用户最烦的那种拦 ✓）。
    slug       TEXT
);
CREATE INDEX IF NOT EXISTS idx_workshop_tasks
    ON workshop_tasks(group_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workshop_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL,          -- 谁的工坊（会话也是按他分的）
    slug        TEXT    NOT NULL DEFAULT '',-- ★ 死列（见上面那段）；迁移用完就不读了
    sender_type TEXT    NOT NULL,          -- 'user' | 'agent'
    content     TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    task_id     INTEGER,                   -- 属于哪条对话（迁移前的老行是 NULL）
    -- ★ ★ 2026-10-07 深夜：**把群聊那套聊天能力搬过来** ✗→✓ ——
    --   用户定的：「组件 diy 界面的聊天界面的功能应该套用生活管家的模板，
    --   比如…底部聊天框的右边加个添加图片按钮…图片也和生活管家一样
    --   添加后不立刻发送，而是等文字后一起发送」✓。
    -- ⚠️ **和 `messages` 那几张列同名同义** ✓ —— 两边形状一致，
    --    `_image_parts` / `_quote` 那些现成件才搬得动 ✓（见 routes_workshop.py ✓）。
    msg_type    TEXT    NOT NULL DEFAULT 'text',   -- 'text' | 'image'
    media_path  TEXT,                      -- 相对 media_dir
    media_meta  TEXT,                      -- JSON
    reply_to    INTEGER,                   -- 引用的是**本表**哪一条
    mentions    TEXT                       -- JSON（工坊里没有 @ 的对象，留列备用）
);
CREATE INDEX IF NOT EXISTS idx_workshop_msgs
    ON workshop_messages(group_id, user_id, id);

-- ★ 2026-10-08：这两张表从壳搬过来 ✓（合并那次）。形状照抄壳那份 ✓，
--   连注释里那条"为什么"也一起搬 —— 它们是当初踩过才写下来的 ✓。
--
-- 内测码。**注册的闸门** —— 只有拿得到码的人能建账号 ✓。
-- 为什么用一张表而不是写死在配置里：码要能**一批一批发** ✓、
-- 能看见"谁什么时候用了" ✓。以后真要开放注册，在**这一层**换（换手机号验证 ✓）。
CREATE TABLE IF NOT EXISTS beta_codes (
    code       TEXT PRIMARY KEY,
    note       TEXT,                    -- 发给谁 / 干什么用（只给自己看）
    created_at INTEGER NOT NULL,
    used_by    INTEGER,                 -- 用了就记下来，NULL = 还没用
    used_at    INTEGER
);

-- 「上次在用的空间」。
--
-- ★ 2026-10-06 从**手机上的 localStorage** 搬到服务端 ✓ —— 那是个"标记" ✓，
--   而标记会丢 ✗（URL 参数丢了 ✗、`lg_back` 丢了 ✗）。按账号存在服务端就丢不了 ✓，
--   顺带白捡一条：同一台手机换账号**不会串** ✓（存本机就会串 ✗）。
-- ⚠️ **一人一空间之后 `default_ws` 没用了** ✗（只有一个，没什么可"默认"的 ✓），
--   但**列保留** —— 迁移规矩是只加不删 ✓，而且 `last_ws` 还有用
--   （"上次在哪个空间"= 这一个 ✓，留给以后可能的多空间 ✓）。
CREATE TABLE IF NOT EXISTS user_prefs (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    default_ws TEXT,
    last_ws    TEXT
);

-- 登录失败计数。存在的理由：密码是用户自设的短密码，一旦服务被暴露，
-- 没有限流就是几秒钟的事。
--
-- **按用户名计数，不按 IP**：走 SSH 隧道时所有请求的源 IP 都是 127.0.0.1，
-- 按 IP 限流等于没限。按用户名至少能挡住针对某个账号的爆破。
CREATE TABLE IF NOT EXISTS login_attempts (
    username     TEXT PRIMARY KEY,
    fail_count   INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0,   -- 当前计数窗口起点
    locked_until INTEGER NOT NULL DEFAULT 0    -- 锁定到期时间
);

-- `agent_state` 已删除（2026-10-04）。它装的是冷却时刻、当日发言预算、
-- 提问回执窗口、沉默计数、活跃度档位——**判断闸撤掉之后这些全没了消费者**。
-- 它从来没存过有价值的东西，所以是干净地删掉，不像 ledger_entries / group_memory
-- 那样保留存档。见 _drop_retired_tables。
"""


_conn: aiosqlite.Connection | None = None


async def get_conn() -> aiosqlite.Connection:
    """取进程内共享连接。aiosqlite 串行化访问，这个规模足够。"""
    global _conn
    if _conn is None:
        settings.ensure_dirs()
        _conn = await aiosqlite.connect(settings.db_path)
        _conn.row_factory = aiosqlite.Row
        # WAL：读写并发；foreign_keys 默认关闭，必须显式开。
        await _conn.execute("PRAGMA journal_mode=WAL")
        await _conn.execute("PRAGMA foreign_keys=ON")
        await _conn.execute("PRAGMA synchronous=NORMAL")
        # **写冲突时等一会儿，而不是立刻报错。**
        #
        # WAL 允许并发读、但**写还是只能一个**。默认 busy_timeout=0，撞上在写的时候
        # 直接抛 "database is locked"。
        #
        # 服务进程内部其实撞不到（单进程一个连接，aiosqlite 自己串行化）。但
        # ① 我们现在有提醒和空闲两个后台循环在写，② 外部脚本（迁移、排查、测试）
        # 会连同一个库——实测就这么撞过一次，报错信息还很不像"并发问题"。
        # 设 5 秒之后，撞上就排队等，而不是莫名其妙地失败。
        await _conn.execute("PRAGMA busy_timeout=5000")
        await _conn.commit()
    return _conn


# 已存在的库需要补的列。SQLite 没有 ADD COLUMN IF NOT EXISTS，只能先查 PRAGMA。
_MIGRATIONS: list[tuple[str, str, str]] = [
    # 群属于哪个 Hermes Profile 目录（= 哪个"记忆空间"）。
    #
    # **一个群 ⇄ 一个空间，双向唯一，不能共用。** 不是"同 profile 的群共享记忆"——
    # 共用会让 Hermes 的 MEMORY.md / USER.md（Profile 级单文件）把一边的私事
    # 注入到另一边，实测发生过。唯一性由下面的 _ensure_profile_unique 兜。
    ("groups", "profile", "TEXT NOT NULL DEFAULT 'couple'"),
    # 管家在这个群里的显示名。可改（设置界面），留空则用全局默认。
    ("groups", "agent_name", "TEXT"),
    # 每个群里的独立昵称。可改，与账号名互不影响——
    # 账号是登录凭证，昵称是群内显示名，两者刻意分开。
    ("group_members", "nickname", "TEXT"),
    # 这条消息 @ 了谁。JSON 数组，如 ["agent","17"]。
    # 显式存而不是从正文解析——@ 逻辑要可靠，不能被文本格式影响。
    ("messages", "mentions", "TEXT"),
    # 记录被"删掉"的时间。**软删除**：行还在，只是查询默认不看它。
    #
    # 为什么账目不真删：那是一条**账**。用户说"这条记错了"，
    # 我们要能改、能撤，但**不能让它无声地消失**——月底对账时少一笔、
    # 又查不出为什么，比记错本身更糟。所以：软删 + 留痕（见 record_history）。
    ("records", "deleted_at", "INTEGER"),
    # 群管家沉默状态文字（不打算理你们时短暂显示的文字）。默认"不打算进你们喵"。
    ("groups", "agent_silent_status", "TEXT"),
    # 群管家待机状态池（JSON 数组，如 ["正在摸鱼…","正在发呆…"]）。
    # 留空则用前端默认池。
    ("groups", "agent_idle_pool", "TEXT"),
    # 状态池轮换间隔（秒）。默认 600（10 分钟）。
    ("groups", "agent_pool_interval", "INTEGER"),
    # "正在思考"这一档的文案（我们说话后、它在想怎么说时显示）。
    ("groups", "agent_thinking_status", "TEXT"),
    # 群管家自己的头像。相对 ui_dir 的路径，如 "avatars/g7.png"。
    # 留空就退回服务端的 /ui/avatar.png。
    ("groups", "agent_avatar", "TEXT"),
    # ★★ 管家状态条的三档文案 **整个存成一个 JSON** ✓ —— 2026-10-06 加。
    #
    # **为什么不像以前那样拆成好几列** ✗：那四列（idle_pool / pool_interval /
    # silent_status / thinking_status）是**同一个东西的四块** ✓，
    # 每加一个维度就要再加一列 ✓，而且"默认值/怎么兜底"会散在好几个函数里 ✗
    # —— 那是"同一个信息两处"的温床 ✓（那天在群名和群列表上各栽过一次 ✓）。
    #
    # 形状与默认值**只定义在一个地方**：`app/agent_status.py` ✓。
    ("groups", "agent_status", "TEXT"),
    # ★ 「给管家的话」✓ —— 每个空间一段，每一轮自动注入 ✓（见 orchestrator/agent.py
    # 的 `_group_persona` ✓）。用户自己写的、关于**他们是谁**的一段话 ✓。
    ("groups", "agent_user_prompt", "TEXT"),
    # ★ 创意工坊的总开关（2026-10-07）✓ —— 出问题能**一键关**，而且**不影响主群聊** ✓。
    #   默认开 ✓（工坊已经部署了 ✓）。关掉之后：工坊那两屏还在 ✓，
    #   但"做组件"的对话入口会说还没接上 ✓（比整片白屏好 ✓）。
    ("groups", "workshop_enabled", "INTEGER NOT NULL DEFAULT 1"),
    # ★ 「diy 小助手」的名字和头像（2026-10-07 深夜 ✓）—— 用户定的：
    #   「agent 叫 diy 小助手，这个小助手的信息可以在导航界面右上角进入…
    #     这个助手每个组件里通用」✓。
    #   ⚠️ **和 `agent_name` / `agent_avatar` 分开** ✗ —— 那是**群里那个管家** ✓
    #      （群聊里说话的、APP 里到处都用的那个身份 ✓）；
    #      这是**做组件时跟他对话的那个** ✓。两个身份、两套名字 ✓，
    #      共用一个的话，改这边的名字会顺手把群聊里管家的名字也改了 ✓
    #      —— 而用户完全没料到会那样 ✓。
    ("groups", "diy_name", "TEXT"),
    ("groups", "diy_avatar", "TEXT"),
    # ★ 三处 `task_id`（2026-10-07 ✓）—— "对话挂到任务上"那次改动 ✓。
    #
    # ⚠️ **新库靠 SCHEMA、老库靠这里，两处都要有** ✗ —— 只写一处就是
    #    "新装的没事、在用的崩" ✓（这个项目最烦那种：测试环境永远碰不到 ✓）。
    #
    # ⚠️ 顺序上必须**先有 `workshop_tasks` 这张表** ✓ —— 但这里只是加列 ✓，
    #    真正回填在 `_migrate_workshop_tasks`（跑在 `_apply_migrations` 之后 ✓）。
    ("workshop_messages", "task_id", "INTEGER"),
    ("components", "task_id", "INTEGER"),
    ("component_tickets", "task_id", "INTEGER"),
    # 这条对话冲着哪个组件去的（见 SCHEMA 里那段 ✓）。定名之前是空的 ✓。
    ("workshop_tasks", "slug", "TEXT"),
    # 用户开做时给它起的名字（见 SCHEMA 里那段 ✓）。
    ("workshop_tasks", "title", "TEXT"),
    # 在等子代理交付（见 SCHEMA 里那段 ✓）—— 落库是为了**重启后能捡回来** ✓。
    ("workshop_tasks", "awaiting", "INTEGER"),
    # 这一版在"容纳界面"里怎么展示（见 SCHEMA 里那段 ✓）。
    ("components", "spot_json", "TEXT"),
    # 工坊聊天的图片和引用（2026-10-07 深夜，见 SCHEMA 里那段 ✓）。
    ("workshop_messages", "msg_type", "TEXT NOT NULL DEFAULT 'text'"),
    ("workshop_messages", "media_path", "TEXT"),
    ("workshop_messages", "media_meta", "TEXT"),
    ("workshop_messages", "reply_to", "INTEGER"),
    ("workshop_messages", "mentions", "TEXT"),
    # ★ 合并那次（2026-10-08）：用户表从"按需镜像"变成"权威" ✓。
    #   老库里这两列都不存在 ✓（它们原本在**壳**那张 users 表上 ✓），
    #   所以要在这里补 —— 老行补出来是 0 / NULL ✓（迁移脚本随后回填 ✓）。
    ("users", "is_admin", "INTEGER NOT NULL DEFAULT 0"),
    ("groups", "uuid", "TEXT"),
    # 正在退出（见 SCHEMA 里那段 ✓）。老行补出来是 NULL ✓ = 正常 ✓。
    ("groups", "deleting_at", "INTEGER"),
    # 自我介绍（见 SCHEMA 里那段 ✓）。老行补出来是 NULL ✓ = 没写 ✓。
    ("group_members", "self_intro", "TEXT"),
]


async def _apply_migrations(conn: aiosqlite.Connection) -> None:
    for table, column, decl in _MIGRATIONS:
        async with conn.execute(f"PRAGMA table_info({table})") as cur:
            existing = {row[1] for row in await cur.fetchall()}
        if existing and column not in existing:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


async def _migrate_agent_status(conn: aiosqlite.Connection) -> None:
    """把旧的四个散列**并进**新的 `agent_status` ✓ —— 跑一次就完 ✓。

    **幂等** ✓：已经有新配置的群直接跳过 ✓（所以脚本可以重跑、可以随启动跑 ✓）。

    跑完那四列就是**死列**了 ✓ —— 代码里一个引用都不留 ✓
    （"同一份数据两处 = 迟早走岔" ✓，2026-10-06 那天栽过两次 ✓）。
    列本身留着不删 ✓：SQLite 删列要重建整张表 ✓，风险不值当 ✓。
    """
    from .agent_status import DEFAULT_CONFIG, dumps, normalize
    try:
        async with conn.execute(
            """SELECT id, agent_status, agent_idle_pool, agent_pool_interval,
                      agent_silent_status, agent_thinking_status FROM groups"""
        ) as cur:
            rows = await cur.fetchall()
    except Exception:  # noqa: BLE001
        return                          # 表还没建出来（全新库 ✓）→ 没什么可迁的 ✓

    moved = 0
    for r in rows:
        gid, cur_json, pool, every, silent, thinking = r
        if (cur_json or "").strip():
            continue                    # 已经有新配置 ✓ → 一次都不碰 ✓
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))     # 深拷贝 ✓
        if pool:
            try:
                lines = json.loads(pool)
                if isinstance(lines, list) and lines:
                    cfg["idle"]["lines"] = lines
            except (ValueError, TypeError):
                log.warning("群 %s 的旧待机池不是合法 JSON，按默认值走：%r", gid, str(pool)[:80])
        if every:
            cfg["idle"]["every"] = every
        if silent:
            cfg["silent"]["lines"] = [silent]
        if thinking:
            cfg["thinking"]["lines"] = [thinking]
        await conn.execute("UPDATE groups SET agent_status = ? WHERE id = ?",
                           (dumps(normalize(cfg)), gid))
        moved += 1
    if moved:
        await conn.commit()
        log.info("把 %d 个群的旧状态文案并进了新配置 ✓", moved)


async def _migrate_workshop_tasks(conn: aiosqlite.Connection) -> None:
    """把老的工坊消息**按 `(群, 用户, slug)` 分堆**，每堆补一条任务 ✓ —— 跑一次完 ✓。

    为什么按这个分：老数据的钥匙就是 `slug` ✓（在组件维度上是分得开的 ✓），
    而**同一个人"＋做一个新的"两次**那两条（slug 都空 ✓）在库里已经分不开了 ✗ ——
    那两条会被合并成**一条**任务 ✓。这是这次迁移**唯一补不回来的东西** ✓，
    所以在这里写明白 ✓，别当作"迁完了、跟原来一样" ✓。

    **幂等** ✓：只看 `task_id IS NULL` 的行 ✓ —— 跑过的堆不会再动 ✓。
    所以它随启动跑也无所谓 ✓（和新库上什么事都不做是一个效果 ✓）。

    跑完 `slug` 就是**死列**了 ✓ —— 代码里一个引用都不留 ✓（列本身留着不删 ✓，
    和 `groups` 那四列同一个理由 ✓：SQLite 删列要重建整张表 ✓，风险不值当 ✓）。
    """
    try:
        async with conn.execute(
            "SELECT group_id, user_id, COALESCE(slug, '') AS s,"
            "       MIN(created_at), MAX(created_at)"
            "  FROM workshop_messages WHERE task_id IS NULL"
            " GROUP BY group_id, user_id, COALESCE(slug, '')"
            " ORDER BY MIN(id)"
        ) as cur:
            piles = await cur.fetchall()
    except Exception:  # noqa: BLE001
        return                          # 表还没建出来（全新库 ✓）→ 没什么可迁的 ✓

    # ⚠️ 任务上的 `slug` **一并填上** ✓ —— 迁移过来的任务本来就是冲着
    #    某一个组件去的 ✓（不然它们会全部算进"没做成的半成品" ✓，
    #    凭空占掉那 3 个名额里的几个 ✓ —— 用户会看到额度莫名其妙没了 ✓）。
    #    slug 是空的那种（老数据里"＋做一个新的"之后说的话 ✓）留空 ✓，那是对的 ✓。
    for gid, uid, slug, t0, t1 in piles:
        ins = await conn.execute(
            "INSERT INTO workshop_tasks(group_id, user_id, created_at, updated_at, slug)"
            " VALUES(?,?,?,?,?)",
            (gid, uid, int(t0 or now()), int(t1 or t0 or now()), slug or None))
        await conn.execute(
            "UPDATE workshop_messages SET task_id = ?"
            " WHERE task_id IS NULL AND group_id = ? AND user_id = ?"
            "   AND COALESCE(slug, '') = ?",
            (ins.lastrowid, gid, uid, slug))
    if piles:
        await conn.commit()
        log.info("把 %d 堆老的工坊消息补成了任务 ✓", len(piles))


async def _ensure_profile_unique(conn: aiosqlite.Connection) -> None:
    """兜住"一个群 ⇄ 一个记忆空间"这条硬约束。

    放在数据层，是因为前面几层都可能被绕过（直接改库、以后加的新接口、
    忘了校验的脚本）。唯一索引是最后一道，也是唯一一道**绕不过去**的。

    **刻意不写进 SCHEMA。** SCHEMA 是每次启动 `executescript` 一把跑的，
    万一历史数据已经违规（两个群共用一个空间），它会直接抛异常——
    连服务都起不来，聊天也用不了。这里改成**报告而不致死**：
    服务照常起来，但日志里把是哪几个群在共享点名列出来。

    宁可是"能用但不安全 + 日志里吵"，也不要"干脆宕机"——后者会让人
    为了恢复使用而急着乱改，反而更容易改错。
    """
    try:
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_profile ON groups(profile)"
        )
        await conn.commit()
    except Exception:
        log.error("⚠ groups.profile 有重复，唯一约束没能建立——记忆可能跨群泄露！")
        async with conn.execute(
            """SELECT profile, GROUP_CONCAT(name, ' / ') AS groups, COUNT(*) AS n
               FROM groups GROUP BY profile HAVING n > 1"""
        ) as cur:
            for row in await cur.fetchall():
                log.error("  空间 %r 被 %d 个群共用：%s", row[0], row[2], row[1])
        log.error("  处置：给其中一个群换成它自己的空间（见 app/spaces.py 的操作指引）")


# 退休的表：**直接 DROP**，不保留存档。
#
# 和 ledger_entries / group_memory 不一样——那两张里面有真实数据（账目、群记忆），
# DROP 不可逆所以留着。这张从来只装编排层的临时状态（冷却时刻、发言计数…），
# 没有任何值得留的东西，留着只会让人以为它还在起作用。
_RETIRED_TABLES: list[tuple[str, str]] = [
    ("agent_state", "判断闸撤掉后，它维护的冷却/预算/回执窗口全没了消费者"),
]


async def _drop_retired_tables(conn: aiosqlite.Connection) -> None:
    for table, why in _RETIRED_TABLES:
        async with conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ) as cur:
            if not await cur.fetchone():
                continue
        await conn.execute(f"DROP TABLE {table}")
        log.info("已删除退休的表 %s（%s）", table, why)


async def init_db() -> None:
    conn = await get_conn()
    await conn.executescript(SCHEMA)
    await _apply_migrations(conn)
    await _migrate_agent_status(conn)
    # ⚠️ **必须在 `_apply_migrations` 之后** ✗ —— 它要读 `task_id` 那一列 ✓
    #    （老库那一列是刚加上去的 ✓，新库在 SCHEMA 里就有 ✓）。
    await _migrate_workshop_tasks(conn)
    await _ensure_profile_unique(conn)
    await _drop_retired_tables(conn)
    await conn.commit()


async def close_db() -> None:
    global _conn
    if _conn is not None:
        await _conn.close()
        _conn = None


def now() -> int:
    return int(time.time())


async def fetch_one(sql: str, params: Sequence[Any] = ()) -> dict | None:
    conn = await get_conn()
    async with conn.execute(sql, params) as cur:
        row = await cur.fetchone()
        return dict(row) if row else None


async def fetch_all(sql: str, params: Sequence[Any] = ()) -> list[dict]:
    conn = await get_conn()
    async with conn.execute(sql, params) as cur:
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """执行写操作，返回 lastrowid。"""
    conn = await get_conn()
    cur = await conn.execute(sql, params)
    await conn.commit()
    return cur.lastrowid or 0


async def execute_rc(sql: str, params: Sequence[Any] = ()) -> int:
    """执行写操作，返回**影响了几行** ✓（`rowcount` ✓）。

    ⚠️ **和 `execute()` 是两个东西，别混** ✗→✓（2026-10-07 深夜踩到）：
      `execute()` 返回的是 `lastrowid` ✓ —— 那是"上一次 INSERT 的行号" ✓。
      拿它去判一条 UPDATE 影响了几行，**它永远非零** ✗（是**别的**语句留下的号 ✓）——
      于是 `if not n: 404` 那种检查**永远不会触发** ✓（该报没找到的地方，
      安静地成功 ✓）。这类错**没有任何症状** ✓：改不存在的对象 → 返回成功 ✓。

      要用"影响几行"做判断（存不存在 ✓、改到没改到 ✓、清了几条 ✓），就用这个 ✓。
    """
    conn = await get_conn()
    cur = await conn.execute(sql, params)
    await conn.commit()
    return int(cur.rowcount or 0)


async def execute_many(sql: str, seq: Iterable[Sequence[Any]]) -> None:
    conn = await get_conn()
    await conn.executemany(sql, seq)
    await conn.commit()
