"""集中配置。所有可调项走环境变量，便于本地/服务器两套环境。"""

from pathlib import Path

# ── ★ 「组件收纳页」那条对话 / 那一格的 slug（2026-10-08 定的，2026-10-09 收到这儿）──
#
# ⚠️ **只留这一处** ✗→✓：它原来在 `main.py` / `routes_internal.py` / 前端各写了一份 ✓
#    （前端那一份还是必须的 ✓ —— 那是另一个语言 ✓），
#    而后端这边**一份就够** ✓：两个模块各写一份，改一处漏一处是迟早的事 ✓。
WALL_SLUG = "wall"

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LG_", extra="ignore")

    # 数据目录：SQLite 库 + 媒体文件
    data_dir: Path = Path("./data")

    # ── 界面层：原来"下放给 agent"的那一块 —— **2026-10-11 收回** ✗→✓ ────
    #
    # 用户重新划线：**agent 除了创意工坊的落点，其它一律不改** ✓。
    # 所以 `ui/` 和 `app/` 一样归 `root:root` 只读 ✓ —— agent 写不了
    # 配色/脚本/头像了 ✗（原来那三个内部接口也一并摘掉了 ✓，见 routes_internal.py）。
    #
    # 历史（2026-10-04 → 2026-10-11）：那一段是"**只守链路、不守文件**" ✓ ——
    # 代码随便 agent 改，改坏了 git 回滚 + 对讲机兜底。那套随 App 管家一起废了 ✓。
    #
    # **分界线是「改坏了的后果」，不是「是不是代码」**：
    #   · 改这里 → 最多难看 / 那个组件显示不出来；**文件删掉就回默认** ✓
    #   · 改核心 → 宕机（改后端等于能执行任意代码）
    #   · 改 `index.html` 那个壳 → 原本担心**凭证泄露**（`lg_token` 存在那个页面的
    #     localStorage 里）。**2026-10-04 这条已经解掉了**：令牌搬进了 httpOnly
    #     Cookie，页面上的任何 JS 都读不到它——所以 `ui/app.js` 才敢开（见下）。
    #
    # 所以壳锁着（改它 = 能把界面改瘫，且它是"壳"不是"内容"），
    # 而外观和行为以**覆盖层**的形式敞开。
    ui_dir: Path = Path("./ui")

    @property
    def theme_path(self) -> Path:
        """agent 写的配色覆盖。**不存在就用内置默认**——这就是"改坏了"的自愈方式。"""
        return self.ui_dir / "theme.css"

    @property
    def script_path(self) -> Path:
        """agent 写的前端脚本，挂在页面末尾执行。

        它**改不了壳**（`static/index.html` 归 root），但它能在壳跑完之后接手：
        `window.LifeGuard` 上开了几个钩子和工具函数给它用。

        敢开这个口子，是因为凭证已经不在页面里了——令牌在 httpOnly Cookie 里，
        这段 JS（或任何一段）都读不到。**先搬凭证、再开脚本**，顺序不能反。
        """
        return self.ui_dir / "app.js"

    @property
    def avatar_path(self) -> Path:
        """agent 自己的头像。不存在就退回名字首字。"""
        return self.ui_dir / "avatar.png"

    @property
    def var_dir(self) -> Path:
        """**服务自己的可变数据** —— 不挂静态、不进 git。

        ⚠️ 和 `ui_dir` 是**两回事** ✗→✓（2026-10-07 做「创意工坊」时分开的）：
        `ui/` 整个挂在 `/ui` 上**没有鉴权** ✓，而且按 `SOUL-app-butler.md` 是
        **归 App 管家管**的 ✓ —— 用户自己做的组件放那儿，等于**谁都能猜着取** ✗，
        还等于让另一个 agent 有权改它们 ✗。
        `var/` 不挂静态 ✓，只能走带 `require_member` 的接口读 ✓。
        """
        return self.data_dir.parent / "var"

    @property
    def components_dir(self) -> Path:
        """**每个群自己的**组件仓库：`var/components/g<群号>/<名字>/`。

        ⚠️ 权限是 **2750（`lifeguard:lgcode`，组只读）** ✓ —— 由 `deploy-chat.sh` 建 ✓。
        **agent 写不进这里** ✓，这正是"没确认过不许写"能真拦的前提 ✓：
        它手里有 `write_file`/bash ✓，只要这个目录它写得进 ✗，
        工具里那些校验就一行都不会执行 ✓（详见方案第七节 ✓）。
        """
        return self.var_dir / "components"

    @property
    def staging_dir(self) -> Path:
        """子代理写 HTML 的地方：`var/staging/`，权限 **2775（agent 可写）** ✓。

        两段式写入的中间站 ✓：服务端在这儿发一个空文件 ✓ →
        子代理把它填上 ✓（它认不出是哪个群 ✓，所以只能按给定路径写 ✓）→
        主对话凭票认领 ✓（见方案第五节 ✓）。
        """
        return self.var_dir / "staging"

    # ── 发布物（APK）────────────────────────────────────────────────────
    #
    # **这是"原生壳"唯一的出口。** 界面能热更新（服务器换个文件就行），
    # 但壳编译在手机里——壳的改动只能重装 APK。这个目录就是那条通道的服务端一半：
    # 放一个 `latest.json`（版本号 + 文件路径 + 说明）和对应的 apk，
    # 手机上的壳开 App 时问一句 `/api/app/latest`，有新版就提示下载安装。
    #
    # 用 `tools/publish-apk.sh` 往这儿放东西，别手工拷贝。
    releases_dir: Path = Path("./releases")

    # JWT
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24 * 30

    # 登录限流。**开公网前必须有**——密码是用户自设的短密码，
    # 没有限流的话 4 位数字几秒就爆破了。
    # 按**用户名**计数：走 SSH 隧道时源 IP 全是 127.0.0.1，按 IP 限流无效。
    login_max_failures: int = 5          # 窗口内允许的失败次数
    login_window_seconds: int = 900      # 计数窗口（15 分钟）
    login_lockout_seconds: int = 900     # 触发后锁多久（15 分钟）

    # Hermes API Server（只绑 localhost，见计划文件的安全约束）
    hermes_base_url: str = "http://127.0.0.1:8642"
    hermes_api_key: str = ""
    # 默认 Profile。群没指定 profile 时用它。
    # ★ 2026-10-07 深夜改的：原来写的是 `couple` ✗ —— 那是**旧项目的共用空间** ✓，
    #   2026-10-07 清理时按用户要求删掉了 ✓。
    #
    # ⚠️ 它的用途只有一个：**群找不到 profile 时的兜底** ✓。
    #    而那个兜底**本来就是出事了**（`spaces.py` 那条硬约束被绕过 ✓）——
    #    所以这个名字要**一眼看出"这儿不该有东西"** ✓：
    #    Hermes 会照名建一个**空**空间 ✓，不会把数据落进别人的记忆里 ✓，
    #    日志里那句"回退到 unassigned"也就说得通了 ✓。
    hermes_default_profile: str = "unassigned"
    # Hermes 家目录，用来读取各 Profile 的 API_SERVER_KEY。
    # 官方要求每个 Profile 独立的 key，default 的 key 在 /p/<name>/ 上会 401，
    # 所以这里不能只存一个 key——按 Profile 现读现用。
    hermes_home: Path = Path("/root/.hermes")

    # ★ 和旧后端不一样的地方：**我们的钥匙串**。
    #
    # 这个服务跑在 lifeguard 名下 ✗ —— 进不去 /root/.hermes（700 ✓），
    # 所以它不直接读各 Profile 的 .env ✗，而是读这儿：
    #
    #     <这个目录>/<profile 名>     root:lifeguard 640，内容就是那一行 key
    #
    # 由开通工作区的那一步抄进来 ✓（见 orchestrator/agent.py:_profile_api_key 的说明）。
    # **只放自己那几个工作区的 key** ✓ —— 这就是"它读不到别人的东西"在密钥这一层的落实 ✓。
    hermes_keys_dir: Path = Path("/opt/lifeguard-chat/keys")

    # 会话票的**签发密钥**。★ 2026-10-08 合并之后，**登录也在这个服务里** ✓，
    # 所以它从"只读别人的密钥"变成了"自己签 ✓"——路径没变 ✓，
    # 因为**模型网关和 App 管家也在拿它验票** ✓（换路径 = 那两边全哑 ✓）。
    #
    # 只读 ✓：本服务在 `lgauth` 组里所以读得到 ✓，
    # 而 agent（hermes 用户）不在那个组里 ✗ —— 它偷不到 ✓。
    shell_jwt_secret: Path = Path("/etc/lifeguard-shell/jwt.secret")

    # ── 合并那次（2026-10-08）从壳搬过来的几项 ─────────────────────────
    #
    # 账号头像。**存文件不存库** ✓（库是"事实"、图是"附件" ✓ 混在一起备份和查数据都变笨 ✓）。
    # ⚠️ 搬家的代价：老文件在 `/opt/lifeguard-shell/var/avatars/`（700 lgshell ✓），
    #    而这个服务跑在 lifeguard 下 ✗ → **P10 切换时拷一份过来** ✓（旧的那份留着，
    #    回滚时旧壳还要用它 ✓）。
    avatar_dir: Path = Path("./var/avatars")

    # 开通/删除空间的**队列目录** ✓ —— 见 routes_shell 里 `provision()` 那段长注释：
    # 这两件事要写 `/root/.hermes` ✓，而这个服务进不去 ✗，也不该为它提权 ✗
    # → 只往这儿写一个请求文件 ✓，由 root 的 systemd `.path` 单元干活 ✓。
    provision_queue: Path = Path("/opt/lifeguard-shell/var/provision")

    # ── 模型池（2026-10-11 从独立的「模型服务」并进来 ✓）────────────────────
    #
    # ⚠️ 那时它在 `/opt/lifeguard-models/var/` ✓（另一个账号的目录 ✓）——
    #    部署时搬过来 ✓（见 `deploy-chat.sh` 里那一步 ✓）。**格式一字不改** ✓。
    models_conf: Path = Path("./var/models.json")
    #: 每次改配置**先留一份旧账** ✓ —— 里面装着所有上游的 key ✗，删一条就真没了 ✓。
    models_keep_dir: Path = Path("./var/models-keep")
    #: 上下文长度队列 ✓ —— 和开通队列同一个套路：**我们只排队，root 干活** ✓
    #: （profile 归 root ✓，见 `tools/set-context-length.sh` ✓）。
    ctx_queue: Path = Path("./var/ctxq")
    #: root 写完的状态文件 ✓ —— 界面读它显示"现在是多少" ✓（**只转述、不猜** ✓）。
    ctx_state: Path = Path("./var/context.json")

    # ★ 一个人只能有一个生活空间 ✓（2026-10-08 用户定的 ✓）。
    # 原来壳那边是 3 ✓ —— 换成 1 之后，`/api/workspaces` 建第二个会被拒 ✓，
    # 文案也说清了"先退出原来那个" ✓。
    max_spaces_per_user: int = 1

    # ★ 一个空间最多 **3 个真人** ✓（管家不算 ✗ —— 它不是 `group_members` 里的一行 ✓，
    # 而是查询时动态拼上去的 ✓，所以直接 COUNT 就是真人数 ✓）。
    # 满员之后邀请码**在加入那一步被拒** ✓（不是把码删掉 ✗：有人退出，名额就该自动回来 ✓）。
    max_space_members: int = 3

    # 空间邀请码 / 内测码的长度（和壳一致 ✓）。
    invite_code_len: int = 8

    # 壳的地址：进工作区时问它"这人真在这个空间里吗" ✓（带用户自己的票去问 ✓）。
    # 见 auth.py / main.py 里那段说明 —— 这样不需要第二套内部凭证 ✓。
    shell_base_url: str = "http://127.0.0.1:8730"

    # 每轮最多带几张图。内联 base64 会让请求体变大，得有个上限。
    max_images_per_turn: int = 3

    # 编排层自己用的轻量模型（接话判断等辅助任务）。
    # 刻意不走 Hermes——这些调用要便宜、要快、要绕开 agent 的完整工具链。
    llm_base_url: str = "https://note3-prev-api.askdiandian.com/v1"
    llm_api_key: str = ""
    llm_model: str = "dots3-note-prev"
    llm_timeout: float = 60.0

    # 管家在群里的自我认知。刻意做成配置项，方便按群覆盖。
    agent_name: str = "管家"

    # 每轮 agent 的推理档位。取值走 Hermes 档位表：
    # none / minimal / low / medium / high / xhigh / max。
    #
    # ⚠️ **实测（2026-10-03）：Dots dots3-note-prev 只有「想 / 不想」两档，
    # 没有中间档，也没有调深度的参数。** 所以这一对配置目前**实际不产生差异**
    # ——留着是为了换模型后好使，不是为了现在。
    #
    # 证据一（经 Hermes 转发，同题、各自独立会话、每档两次）：
    #     不传 / low / minimal / medium / high  → 推理都落在 450~600 字符同一片噪声里
    #     none                                  → 推理 0 字符，4 倍快
    # 证据二（直接打 Dots，试过 reasoning_max_tokens=16/64/128/256/1024、
    #        max_thinking_tokens、thinking.budget_tokens、reasoning 字典形式）：
    #        全部无效——`=16` 反而比 `=1024` 想得更多，毫无单调性。
    #
    # ⚠️ **`none` 不能用。** 省下的时间是用正确性换的，实测：
    #   - 问"上个月吃饭花了多少"，`none` 下 6 次里 **0 次真的调用 ledger_query**，
    #     只会回"我查一下""查一下，马上告诉你"，然后就没有下文了；
    #     同一个问题在 medium 下 6 次全部正确调工具并给出答案。
    #   - 闲聊里还会**编数字**："我翻了翻最近的账，你们这周在餐饮上已经花了快 400"
    #     —— 那一轮 tool_turns=0，纯属凭空捏造。
    #   对记账管家来说，这两条都是致命的：宁可慢，也不能说"我去查"然后不查。
    #
    # 所以两个档位都保持"想"。真要提速得换模型，不是调这两个值。
    agent_effort_casual: str = "medium"
    agent_effort_mentioned: str = "high"

    # 内部工具接口的共享密钥。Hermes 插件（跑在同一台机器上）用它在
    # /api/internal/tools/* 上读写群记忆与账本。**必须配**，否则内部接口整个关闭。
    internal_token: str = ""

    @property
    def internal_tools_enabled(self) -> bool:
        return bool(self.internal_token)

    # （原来这里有个 group_memory_inject_limit，用于注入我们自己那张群记忆表。
    #  记忆已下放给 Hermes 自己的记忆系统，见 orchestrator/agent.py 的 _group_persona。）

    # ── 熔断（是"安全"，不是"判断"）──────────────────────────────────
    #
    # 判断该不该说的活儿已经交回给 agent 自己（见 SOUL.md 的「插嘴」一节）。
    # 这里留下的**不是品味**，是刹车：防循环、防刷屏、防一次事故烧掉一整天。
    # 分界线是——它不评判"这该不该说"，只在"说得不对劲"时拦。
    #
    # 每分钟最多几轮 agent 发言。默认 6 = 平均 10 秒一轮，
    # 比模型自身耗时（8~20 秒/轮）还宽松，正常聊天碰不到；
    # 只有 bug 循环或消息风暴才会撞上。
    breaker_turns_per_minute: int = 6
    # agent 主动冒泡（group_say）每小时最多几条
    proactive_say_per_hour: int = 3

    # ── 空闲唤醒：让它真的能"自己冒泡" ──────────────────────────────
    #
    # `group_say` 只给了它能力，**能力需要有人来唤起**——一轮只能由"有人发消息"
    # 或"提醒到点"触发。群里半天没人吭声时它根本没机会开口。这个定时器补上那一环。
    #
    # 间隔**随机** 1~4 小时。固定间隔会变成"每 2 小时准时报到"，比不说话更像机器人；
    # 人的话头本来就是不均匀的。配 max=0 可关闭。
    idle_wake_min_hours: float = 1.0
    idle_wake_max_hours: float = 4.0
    # 只在白天醒。半夜三点冒出一句"今天天气不错"是事故不是惊喜。
    # 两个值相等 = 全天。
    idle_wake_from_hour: int = 9
    idle_wake_to_hour: int = 23

    # 编排参数
    trigger_cooldown_seconds: int = 20      # 距上次发言不足此秒数则先不接
    # 「提问回执」窗口时长。管家问完问题后的这段时间内，下一条用户消息
    # 可免冷却——它在等人回答，不该被自己的防刷屏机制挡住。
    awaiting_reply_seconds: int = 180
    daily_speak_budget: int = 120           # 每群每日 agent 发言上限
    context_window_messages: int = 40       # 送给 agent 的上下文条数上限
    semantic_gate_enabled: bool = True      # 关掉则退化为纯规则（省 token）

    # 接话活跃度：每群可覆盖的默认档位（0=很安静，10=很爱聊）。
    # 阈值 = 75 - level*6，再减去沉默补偿。
    default_activity_level: int = 6
    # 连续多少条用户消息没接话后，开始放宽阈值（沉默补偿）。
    silence_compensation_after: int = 3
    # 打分时喂给模型的历史消息条数（含管家自己说的话——它必须看到对话全貌）
    gate_transcript_messages: int = 14
    # 用户在 @ 另一个人（不是管家）时，门槛抬高的点数。
    # 意思是"两人在对话，管家别抢话"——但抬的是门槛不是墙：
    # 它真觉得该说（分数够高）仍然可以说。
    mention_others_penalty: int = 25

    @property
    def db_path(self) -> Path:
        return self.data_dir / "lifeguard.db"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        # 界面层那块也要建出来——它是 agent 的"可写区"，
        # 不存在的话挂载 /ui 会直接起不来
        self.ui_dir.mkdir(parents=True, exist_ok=True)
        # 组件那两个目录：**归 root 那份部署脚本建**（权限是 2750 / 2775，见 deploy-chat.sh）✓。
        # ⚠️ 这里**只保证"在"**，而且建不出来也**不拦服务启动** ✗→✓ ——
        #    这一句跑在 `lifeguard` 名下 ✓，而 `/opt/lifeguard-chat` 是 `root:root 755` ✓，
        #    所以 `var/` 它**根本建不出来** ✗（真抛出来就是"服务起不来"✓，
        #    而症状会像"代码坏了"✗ —— 2026-10-07 差点这么干）。
        #    建不出来只是组件功能不可用 ✓ —— 那要吼一声，但不能把整个服务带走 ✓。
        for _d, _what in ((self.staging_dir, "暂存区"), (self.components_dir, "组件仓库")):
            try:
                _d.mkdir(exist_ok=True)          # 不加 parents：父目录该由部署建好
            except OSError as _exc:
                print(f"⚠️ 组件{_what}建不出来：{_d}（{_exc}）"
                      f" —— 看看 deploy-chat.sh 有没有建 var/", flush=True)
        self.components_dir.mkdir(parents=True, exist_ok=True)
        # 前端脚本目录：**一个功能一个文件**（见 main.py 的 `/` 里那段说明）。
        # 先建出来，agent 加功能时直接往里写新文件就行——不用它自己 mkdir。
        (self.ui_dir / "app").mkdir(parents=True, exist_ok=True)
        # 没有发布物也要能起来——空目录下 /api/app/latest 会如实说"还没发过版本"
        self.releases_dir.mkdir(parents=True, exist_ok=True)
        # 模型池那几个（2026-10-11 并进来的）。**顺序无所谓** ✓ ——
        # `store.load()` 对"文件不在"是宽容的 ✓（回空池子 ✓，不是崩 ✓）。
        for _d in (self.models_conf.parent, self.ctx_queue):
            try:
                _d.mkdir(parents=True, exist_ok=True)
            except OSError:          # pragma: no cover
                pass


settings = Settings()
