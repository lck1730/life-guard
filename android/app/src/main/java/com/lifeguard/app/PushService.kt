package com.lifeguard.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * App 是否正停在前台。
 *
 * 服务和 Activity 在同一个进程里，所以这个静态度量就够用。
 * 只有**前台 + 亮屏**同时成立才算"他看得见"——锁屏时 Activity 可能还
 * 处于 resumed，但人并没有在看。
 */
internal object AppState {
    @Volatile var visible: Boolean = false
}

/**
 * 后台消息提醒（2026-10-21）。
 *
 * ## 为什么是轮询
 *
 * 这个 App 的用户只有几个人，服务器是自己的（WireGuard 内网），
 * vivo/iQOO 的厂商推送要求上架/企业资质，FCM 在国行系统上又不可用。
 * 为一条通知去接一套推送通道，不划算。
 *
 * 服务端没有 `/api/last` 那种"当前这一轮"的接口，但它有更直接的东西：
 * `/api/groups` + `/api/groups/{id}/messages?after=<消息id>`。
 * 轮询这两个接口就能认出**新到的消息**——服务器一行都不用改。
 * 管家和群里其他人发的都会提醒，只有自己发的不提醒
 * （`sender_id` 和 `/api/groups/bootstrap` 里的 `me.id` 比）。
 *
 * ## 怎么判断"该升前台了"
 *
 * 和远程CC不一样，生活管家没有 `running` 标志可看。这里用一个很朴素的
 * 判据：**看到一条新的用户消息 → 接下来一段时间都算"在等回复"**。
 * 等到管家的新消息落库，等待结束。等待超过 [WAIT_TIMEOUT_MS] 就当作
 * 管家不打算回了（它会"窥屏"/不理人），不再挂着。
 *
 * ## 为什么是前台服务、但又不能一直是
 *
 * 普通后台线程会被系统随时收掉，`remoteMessaging` 类型的前台服务不会
 * （而且没有 dataSync 的 6 小时超时）。但前台服务**强制**挂一条通知。
 *
 * 所以：App 在眼前时只是普通 Service（网页自己有 WebSocket，通知纯属多余）；
 * 只有人离开了、而且确实在等回复的那段时间才升前台。回复一到立刻撤掉。
 * 这样不会像 1.2.2 的远程CC那样默认挂着「后台提醒已开启」。
 *
 * ## 去重
 *
 * 每个群记一个"已经看到的最大消息 id"（游标），存在 App 私有 prefs 里。
 * 它是**跨服务重启保留**的：服务被杀一次、再被闹钟叫起来，停机期间
 * 说完的那条回复仍然能被认出来，不会当成基线吞掉。
 * 首次启动（没有游标）只取每个群最新的 1 条当基线，不倒灌历史。
 */
class PushService : Service() {

    private lateinit var prefs: SharedPreferences

    @Volatile private var alive = true

    /** 1.2.3 式的前台生命周期：默认不是前台服务。 */
    @Volatile private var isForeground = false

    /** 上一轮是不是在等回复。用来认出"服务是因为有活干才活着的"。 */
    @Volatile private var lastWaiting = false

    /** 我们自己主动停的（空闲待命）——不是被系统收掉的。 */
    @Volatile private var stoppingIntentionally = false

    /**
     * me.id / 备注表需要重读。界面每次回到眼前都会置位：备注是那一刻改的，
     * 服务没必要为此单独开一条通道。
     */
    @Volatile private var identityStale = true

    private var worker: Thread? = null

    /** 当前真正在用的前台通知通道（NONE 不行才退到 MIN）。 */
    private var serviceCh = CH_SERVICE

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE)
        createChannels()
        // ★ 不在这儿 startForeground：界面用 startService 起我们时不需要通知；
        //   开机/闹钟那条路会在 onStartCommand 里升（5 秒的硬性要求）。
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val c = intent?.getStringExtra(EXTRA_COOKIE)
        if (!c.isNullOrBlank()) prefs.edit().putString(KEY_PUSH_COOKIE, c).apply()

        if (intent?.action == ACTION_VISIBLE) {
            // 人已经在 App 里了：撤掉前台通知，服务继续以普通 Service 跑。
            demote()
            // 他刚在界面里可能改过备注 → 下次轮询前重读一次。
            identityStale = true
        } else if (intent?.getBooleanExtra(EXTRA_PROMOTE, false) == true) {
            // 开机 / 闹钟 / 划掉任务后的复活：startForegroundService 要求
            // 5 秒内必须 startForeground，这里没得选。轮询确认没活干会立刻撤销。
            if (!promote()) {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        if (worker == null) startWorker() else worker?.interrupt()
        return START_STICKY
    }

    /**
     * 用户把 App 从最近任务划掉。
     *
     * Android 的标准行为是"服务继续活"（`stopWithTask=false`），但 OriginOS
     * 会连进程一起杀。能做的只剩两件：
     *   1. 立刻把「他看得见」置 false；
     *   2. 马上再 start 一次，并排一个几秒后的闹钟 —— 有些 ROM 的杀进程晚一步，
     *      这个空档够它把自己接回来；真被 force-stop 了，那什么代码都无能为力。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        AppState.visible = false
        if (prefs.getBoolean(KEY_PUSH_ENABLED, false)) {
            try {
                startService(Intent(this, PushService::class.java).setAction(ACTION_BACKGROUND))
            } catch (_: Exception) {}
            scheduleRestart(this, 5_000L)
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        val wasWaiting = isForeground || lastWaiting
        alive = false
        worker?.interrupt()
        worker = null
        if (wasWaiting && !stoppingIntentionally) {
            try {
                if (prefs.getBoolean(KEY_PUSH_ENABLED, false)) scheduleRestart(this, 5_000L)
            } catch (_: Exception) {}
        }
        super.onDestroy()
    }

    // ── 通知 ──────────────────────────────────────────────────────────

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java) ?: return

        // 前台服务在 Android 上必须挂一条通知，这是硬规定。通道可以设成
        // IMPORTANCE_NONE —— 多数系统上这条通知就**不会出现**；少数 ROM
        // 拒绝用被屏蔽的通道做前台通知，那时退到 IMPORTANCE_MIN。
        val service = NotificationChannel(
            CH_SERVICE, "后台提醒", NotificationManager.IMPORTANCE_NONE
        ).apply {
            description = "保持后台消息提醒所需的通知（平时不显示）"
            setShowBadge(false)
            setSound(null, null)
        }

        val serviceFallback = NotificationChannel(
            CH_SERVICE_FALLBACK, "后台提醒（常驻）", NotificationManager.IMPORTANCE_MIN
        ).apply {
            description = "系统不允许隐藏时，用这条最低优先级的通知顶着"
            setShowBadge(false)
            setSound(null, null)
        }

        val messages = NotificationChannel(
            CH_MESSAGES, "新消息", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "管家或群里其他人发来新消息时提醒"
            enableVibration(true)
            setShowBadge(true)
            // 锁屏上先只显示"管家回了"；正文要解锁才看得到。
            lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
        }

        nm.createNotificationChannel(service)
        nm.createNotificationChannel(serviceFallback)
        nm.createNotificationChannel(messages)
    }

    /**
     * 前台服务那条**系统强制**的通知。
     *
     * ⚠️ 正文固定成「后台运行中」——**不再**跟着轮询状态变（"正在等管家回复…"
     * 那种）。用户要的是"只有真正发出来的新消息才提醒"，前台通知只是
     * Android 的硬性要求；通道正常情况下是 IMPORTANCE_NONE（看不见）。
     */
    private fun serviceNotification(channel: String): Notification =
        NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("后台运行中")
            .setOngoing(true)
            .setShowWhen(false)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp())
            // ★ 故意不设 FOREGROUND_SERVICE_IMMEDIATE：
            //   Android 12+ 默认会先压最多 10 秒。回复很快就说完的话，
            //   我们会在通知露面之前就停掉服务 —— 这条通知根本不出现。
            .build()

    private fun startAsForeground(): Boolean {
        val type = if (Build.VERSION.SDK_INT >= 34)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0

        serviceCh = CH_SERVICE
        try {
            ServiceCompat.startForeground(
                this, ID_SERVICE, serviceNotification(CH_SERVICE), type
            )
            return true
        } catch (_: Exception) {
            // 有些 ROM 不接受 IMPORTANCE_NONE 的通道做前台通知 → 退一步。
        }

        return try {
            serviceCh = CH_SERVICE_FALLBACK
            ServiceCompat.startForeground(
                this, ID_SERVICE,
                serviceNotification(CH_SERVICE_FALLBACK), type
            )
            true
        } catch (_: Exception) {
            // 极少数 ROM 会拦（权限被改、后台限制）。别让整个 App 跟着崩；
            // 通知不了不代表线程不能继续轮询。
            false
        }
    }

    /** 升成前台服务。**只在"确实离开 App、而且确实有活跃对话"时调用**。 */
    private fun promote(): Boolean {
        if (isForeground) return true
        val ok = startAsForeground()
        isForeground = ok
        return ok
    }

    /** 退出前台状态，但**不杀服务**：通知立刻消失，轮询线程继续。 */
    private fun demote() {
        if (!isForeground) return
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {}
        isForeground = false
    }

    /**
     * 消息通知。**只有真正落库的新消息才会走到这里**（思考中/正在回复不发）。
     *
     * @param id    通知 id：同一个发送者用同一个 id，后来的消息覆盖前一条，
     *              不同的人各自留一条（不会互相盖掉）。
     * @param title 管家名，或发消息那个人的备注/昵称。
     * @param text  消息正文；不拼接群名，按用户的要求「标题是谁、内容是什么」。
     */
    private fun notifyMessage(
        id: Int,
        title: String,
        text: String,
        atMs: Long,
        auth: Boolean = false,
    ) {
        if (!canNotify()) return
        val full = text.trim()
        if (full.isEmpty()) return
        val preview = full.replace(Regex("\\s+"), " ").take(160)

        val b = NotificationCompat.Builder(this, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF6EA8FF.toInt())
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(NotificationCompat.BigTextStyle().bigText(full.take(4000)))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(
                if (auth) NotificationCompat.CATEGORY_ERROR
                else NotificationCompat.CATEGORY_MESSAGE
            )
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(openApp())
        if (atMs > 0L) b.setWhen(atMs).setShowWhen(true)

        try {
            NotificationManagerCompat.from(this).notify(id, b.build())
            // 记下来：打开 App 时要把这些通知逐条收掉。
            rememberShown(id)
        } catch (_: Exception) {
            // 通知权限刚被撤销之类的竞态；轮询线程不能因为这一下死掉。
        }
    }

    /** 发过的消息通知 id（打开 App 时按这份清单逐条撤销）。 */
    private fun rememberShown(id: Int) {
        try {
            val key = id.toString()
            val cur = prefs.getStringSet(KEY_SHOWN_IDS, emptySet()) ?: emptySet()
            if (key !in cur) {
                // getStringSet 返回的是内部引用，**不能原地改** → `cur + key` 新建一份。
                prefs.edit().putStringSet(KEY_SHOWN_IDS, cur + key).apply()
            }
        } catch (_: Exception) {}
    }

    private fun openApp(): PendingIntent {
        val i = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        return PendingIntent.getActivity(
            this, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun canNotify(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** "他正看着这个 App"——前台**并且**亮屏。 */
    private fun userIsLooking(): Boolean {
        if (!AppState.visible) return false
        return try {
            (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
        } catch (e: Exception) {
            true
        }
    }

    // ── 轮询 ──────────────────────────────────────────────────────────

    private fun startWorker() {
        if (worker != null) return
        worker = Thread({
            var backoff = 6_000L
            var lastAuthNoticeAt = 0L
            var idleSince = 0L
            var state = loadState()
            var waitUntil = prefs.getLong(KEY_WAIT_UNTIL, 0L)
            var dirty = false
            // 自己的 user id：只用来把"自己发的消息"排除在提醒之外。
            // 拿不到（0）时宁可不提醒别人的文字消息，也不能把自己的弹出来。
            var myId = 0L
            // 备注表：`{对方 user_id: 备注}`。提醒标题里备注优先于昵称。
            var notes = JSONObject()
            var meCookie = ""

            fun persist() {
                if (!dirty) return
                prefs.edit()
                    .putString(KEY_STATE, state.toString())
                    .putLong(KEY_WAIT_UNTIL, waitUntil)
                    .apply()
                dirty = false
            }

            /**
             * 后台待命判定：人不在 App 里、也没有在等回复，连续 [IDLE_STOP_MS]
             * 之后就自己停。手机放桌上时没有常驻服务、没有轮询、没有通知。
             *
             * ⚠️ 网络不通时**不停**：可能只是隧道抖了一下，停了就再也接不回来。
             */
            fun standbyDue(waiting: Boolean): Boolean {
                val now = System.currentTimeMillis()
                if (AppState.visible || waiting) {
                    idleSince = 0L
                    return false
                }
                if (idleSince == 0L) idleSince = now
                return now - idleSince >= IDLE_STOP_MS
            }

            loop@ while (alive) {
                val base = (prefs.getString(MainActivity.KEY_SERVER, MainActivity.DEFAULT_SERVER)
                    ?: MainActivity.DEFAULT_SERVER).trimEnd('/')

                if (base.isBlank()) {
                    if (!userIsLooking()) demote()
                    sleepFor(15_000L)
                    continue
                }

                // 换了服务器（换主机/端口）→ 旧服务器的消息 id 不能拿来比，重新起基线。
                if (state.optString("server", "") != base) {
                    state = JSONObject().put("server", base).put("groups", JSONObject())
                    waitUntil = 0L
                    myId = 0L
                    meCookie = ""
                    dirty = true
                    persist()
                }

                // 票由界面读好、存在 App 私有 prefs 里。服务自己**不碰
                // CookieManager**：进程被系统重启、还没建过 WebView 时，
                // 后台线程读它可能永远是 null —— 那会变成"服务在、永远不提醒"。
                val cookie = prefs.getString(KEY_PUSH_COOKIE, null)
                if (cookie.isNullOrBlank()) {
                    if (!userIsLooking()) demote()
                    if (standbyDue(false)) { stopStandby(); break@loop }
                    sleepFor(15_000L)
                    continue
                }

                // 换了登录票 = 换了人；界面回到眼前 = 备注可能改过。
                // 这两种情况都要重新问一次 me.id + 备注表。
                if (cookie != meCookie || myId <= 0L || identityStale) {
                    meCookie = cookie
                    val ident = try { fetchIdentity(base, cookie) } catch (_: Exception) { null }
                    if (ident != null && ident.id > 0L) {
                        myId = ident.id
                        notes = ident.notes
                        identityStale = false
                    } else {
                        myId = 0L
                    }
                }

                val groupsPoll = try {
                    fetchGroups(base, cookie)
                } catch (e: Exception) {
                    null
                }

                if (groupsPoll == null) {
                    // 网络断了（WireGuard 没连、服务器重启）→ 退避重试，不吵。
                    if (!userIsLooking()) demote()
                    sleepFor(backoff)
                    backoff = (backoff + 6_000L).coerceAtMost(30_000L)
                    continue
                }
                backoff = 6_000L

                if (groupsPoll.status == 401) {
                    // cookie 过期。6 小时内最多提醒一次；不 stopSelf——重新登录后
                    // 同一个服务能自己恢复，不用等下次开 App。
                    if (!userIsLooking()) demote()
                    val now = System.currentTimeMillis()
                    if (now - lastAuthNoticeAt > 6 * 60 * 60 * 1000L) {
                        lastAuthNoticeAt = now
                        if (!userIsLooking()) {
                            notifyMessage(
                                ID_MESSAGE, "需要重新登录",
                                "登录已过期，点开重新登录。", 0L, true
                            )
                        }
                    }
                    if (standbyDue(false)) { stopStandby(); break@loop }
                    sleepFor(30_000L)
                    continue
                }

                val groups = groupsPoll.array
                if (groupsPoll.status != 200 || groups == null) {
                    if (!userIsLooking()) demote()
                    sleepFor(15_000L)
                    continue
                }

                var failed = false

                for (i in 0 until groups.length()) {
                    if (!alive) break
                    val g = groups.optJSONObject(i) ?: continue
                    val gid = g.optLong("id", 0L)
                    if (gid <= 0L) continue
                    // 通知标题用**这个群的管家名**（用户在设置里改过的那个）。
                    val agentName = jsonText(g, "agent_name").ifBlank { "管家" }

                    val groupsState = state.optJSONObject("groups")
                        ?: JSONObject().also { state.put("groups", it) }
                    val gs = groupsState.optJSONObject(gid.toString())
                        ?: JSONObject().also { groupsState.put(gid.toString(), it) }
                    val initialized = gs.optBoolean("init", false)
                    var cursor = gs.optLong("cursor", 0L)

                    val poll = try {
                        // 还没基线时只取最新 1 条（`after=0` 的服务端语义是"最新一批"）
                        fetchMessages(base, cookie, gid, cursor, if (initialized) 200 else 1)
                    } catch (e: Exception) {
                        null
                    }

                    if (poll == null) {
                        if (!userIsLooking()) demote()
                        failed = true
                        break
                    }
                    if (poll.status == 401) {
                        if (!userIsLooking()) demote()
                        failed = true
                        break
                    }
                    val arr = poll.array
                    if (poll.status != 200 || arr == null) {
                        failed = true
                        break
                    }
                    if (!initialized) {
                        // 基线：当前最新那条只用来定游标，**不发提醒**（历史不算新消息）。
                        val last = if (arr.length() > 0) arr.optJSONObject(arr.length() - 1) else null
                        cursor = last?.optLong("id", 0L) ?: 0L
                        gs.put("cursor", cursor)
                        gs.put("init", true)
                        gs.put("sender", last?.optString("sender_type", "") ?: "")
                        dirty = true
                    } else {
                        // 管家的回复可能被服务端拆成好几条（`_split_parts`）。
                        // 同一批里合并成一条通知，否则通知栏只会剩下最后一截。
                        val agentParts = StringBuilder()
                        var lastAgentAt = 0L
                        // 同一个人这一批里连发几句也接成一条；不同的人各留一条通知。
                        val humanParts = LinkedHashMap<Long, StringBuilder>()
                        val humanNames = HashMap<Long, String>()
                        val humanAt = HashMap<Long, Long>()
                        for (j in 0 until arr.length()) {
                            val m = arr.optJSONObject(j) ?: continue
                            val id = m.optLong("id", 0L)
                            if (id <= cursor) continue
                            val sender = m.optString("sender_type", "")
                            val now = System.currentTimeMillis()

                            when (sender) {
                                "user" -> {
                                    // 有人说话了 → 接下来一段时间算"在等回复"。
                                    waitUntil = now + WAIT_TIMEOUT_MS
                                    dirty = true
                                    // ★ 别人说的也要提醒；自己发的不提醒 ——
                                    //   否则"发完立刻划掉 App"，下一轮会把自己的
                                    //   消息当成新消息弹出来。
                                    val senderId = m.optLong("sender_id", 0L)
                                    if (myId > 0L && senderId != myId) {
                                        val body = messagePreview(m)
                                        if (body.isNotBlank()) {
                                            // 标题：备注优先，没有备注用昵称。
                                            // ⚠️ JSON null 不能用 optString 直接取：
                                            //   org.json 会把它变成字符串 "null"。
                                            val noteKey = senderId.toString()
                                            val note =
                                                if (notes.isNull(noteKey)) ""
                                                else notes.optString(noteKey, "").trim()
                                            val nick = jsonText(m, "sender_nickname")
                                            humanNames[senderId] =
                                                note.ifBlank { nick }.ifBlank { "有人" }
                                            val sb = humanParts.getOrPut(senderId) {
                                                StringBuilder()
                                            }
                                            if (sb.isNotEmpty()) sb.append('\n')
                                            sb.append(body)
                                            humanAt[senderId] = now
                                        }
                                    }
                                }
                                "agent" -> {
                                    // 管家的消息落库了 —— 这一轮等待结束。
                                    waitUntil = 0L
                                    dirty = true
                                    val body = messagePreview(m)
                                    if (body.isNotBlank()) {
                                        if (agentParts.isNotEmpty()) agentParts.append('\n')
                                        agentParts.append(body)
                                        lastAgentAt = now
                                    }
                                }
                            }

                            cursor = id
                            gs.put("cursor", cursor)
                            gs.put("sender", sender)
                            dirty = true
                        }
                        // 只有"他确实没在看"才提醒。管家思考期间没有任何消息落库，
                        // 所以这里不会出现"正在回复"之类的东西。
                        if (!userIsLooking()) {
                            // 人名消息先发（时间更早），管家的回复最后发，通知栏里它在上。
                            for ((sid, sb) in humanParts) {
                                if (sb.isEmpty()) continue
                                notifyMessage(
                                    humanNotifId(sid),
                                    humanNames[sid] ?: "有人",
                                    sb.toString(),
                                    humanAt[sid] ?: 0L,
                                )
                            }
                            // 一整轮回复说完才提醒一次（拆分的那几截已经接起来了）。
                            if (agentParts.isNotEmpty()) {
                                notifyMessage(
                                    agentNotifId(gid), agentName,
                                    agentParts.toString(), lastAgentAt
                                )
                            }
                        }
                    }
                    // 每个群处理完就落盘：后面的群失败时，前面的进度不能丢
                    // （否则下一轮会把已经提醒过的消息再提醒一遍，或者漏掉没提醒的）。
                    persist()
                }

                if (failed) {
                    sleepFor(15_000L)
                    continue
                }

                val now = System.currentTimeMillis()
                // 超时还没等到 → 不再算等待（管家可能故意不理人）。
                if (waitUntil > 0L && waitUntil <= now) {
                    waitUntil = 0L
                    dirty = true
                    persist()
                }
                val waiting = waitUntil > now

                // ★ 只有"确实有人在等回复"、而且他看不见的时候才升前台。
                //   App 在眼前 → 服务只是普通 Service，通知栏什么都不挂。
                if (waiting && !userIsLooking()) {
                    promote()
                } else if (!waiting && isForeground && !userIsLooking()) {
                    demote()
                }

                lastWaiting = waiting

                // 只有"有活干"（人在 App 里，或在等回复）才需要兜底闹钟。
                if (waiting || AppState.visible) scheduleRestart(this, WATCHDOG_MS)
                // ★ 留 60 秒待命窗口：他连发两条、第二轮紧接第一轮跑完时，
                //   服务不能在第一轮结束时就已经停了。
                if (standbyDue(waiting)) { stopStandby(); break@loop }
                // 等回复时盯紧一点；平时回到省电节奏。
                sleepFor(if (waiting) 3_000L else 6_000L)
            }
        }, "lifeguard-push").apply {
            isDaemon = true
            start()
        }
    }

    private data class Poll(val status: Int, val array: JSONArray?)

    private fun fetchGroups(base: String, cookie: String): Poll {
        val c = (URL("$base/api/groups").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 8_000
            useCaches = false
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Cache-Control", "no-store")
        }
        return try {
            when (val code = c.responseCode) {
                200 -> Poll(200, JSONArray(c.inputStream.bufferedReader().use { it.readText() }))
                else -> {
                    runCatching { c.errorStream?.bufferedReader()?.use { it.readText() } }
                    Poll(code, null)
                }
            }
        } finally {
            c.disconnect()
        }
    }

    private data class Identity(val id: Long, val notes: JSONObject)

    /**
     * 当前登录用户是谁（`me.id`）+ 他的备注表。
     *
     * 没有单独的用户接口，`/api/groups/bootstrap` 是唯一一处把 `me` 和
     * `notes`（`{对方 user_id: 备注}`）一起带回来的。
     * 票变了（换人登录）或界面回到了眼前（可能刚改备注）会重新问。
     */
    private fun fetchIdentity(base: String, cookie: String): Identity {
        val c = (URL("$base/api/groups/bootstrap?limit=1").openConnection()
            as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 8_000
            useCaches = false
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Cache-Control", "no-store")
        }
        return try {
            if (c.responseCode != 200) {
                Identity(0L, JSONObject())
            } else {
                val o = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                Identity(
                    o.optJSONObject("me")?.optLong("id", 0L) ?: 0L,
                    o.optJSONObject("notes") ?: JSONObject(),
                )
            }
        } finally {
            c.disconnect()
        }
    }

    private fun fetchMessages(
        base: String,
        cookie: String,
        groupId: Long,
        after: Long,
        limit: Int,
    ): Poll {
        val c = (URL("$base/api/groups/$groupId/messages?after=$after&limit=$limit")
            .openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 8_000
            useCaches = false
            setRequestProperty("Cookie", cookie)
            setRequestProperty("Cache-Control", "no-store")
        }
        return try {
            when (val code = c.responseCode) {
                200 -> Poll(200, JSONArray(c.inputStream.bufferedReader().use { it.readText() }))
                else -> {
                    runCatching { c.errorStream?.bufferedReader()?.use { it.readText() } }
                    Poll(code, null)
                }
            }
        } finally {
            c.disconnect()
        }
    }

    /**
     * 通知 id：**同一个人 / 同一个群的管家各占一个**。
     *
     * 以前所有消息共用一个 id，后来的会把前一条盖掉——现在群里好几个人
     * 都可能提醒，共用一个就会"只看到最后说话的那个人"。
     * 同一发送者后来的消息仍然覆盖自己的旧通知（通知栏不堆一摞）。
     */
    private fun agentNotifId(groupId: Long): Int =
        ID_AGENT_BASE + (groupId % 100_000L).toInt()

    private fun humanNotifId(userId: Long): Int =
        ID_HUMAN_BASE + (userId % 100_000L).toInt()

    /** 取字符串字段；JSON null 按空串算（`optString` 会把它变成字面量 "null"）。 */
    private fun jsonText(o: JSONObject, key: String): String =
        if (o.isNull(key)) "" else o.optString(key, "").trim()

    /** 通知栏里那一行正文。图片/语音/文件没有文字时给个占位。 */
    private fun messagePreview(m: JSONObject): String {
        val content = jsonText(m, "content")
        return when (jsonText(m, "msg_type").ifBlank { "text" }) {
            "image" -> if (content.isBlank()) "[图片]" else "[图片] $content"
            "voice", "audio" -> if (content.isBlank()) "[语音]" else "[语音] $content"
            "file" -> if (content.isBlank()) "[文件]" else "[文件] $content"
            else -> content
        }.trim()
    }

    private fun loadState(): JSONObject {
        val raw = prefs.getString(KEY_STATE, null)
        return try {
            if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw)
        } catch (_: Exception) {
            // 存坏了就重来：下一轮会重新起基线，最坏是漏一条旧提醒。
            JSONObject()
        }
    }

    /**
     * 空闲待命：主动停掉自己。
     *
     * 和"被系统杀掉"要区分开 —— 这种停法是**计划内**的，
     * 所以 onDestroy 里不能再排一个复活闹钟，否则会没完没了。
     */
    private fun stopStandby() {
        stoppingIntentionally = true
        demote()
        try { cancelRestart(this) } catch (_: Exception) {}
        stopSelf()
    }

    private fun sleepFor(ms: Long) {
        var left = ms
        while (alive && left > 0L) {
            try {
                Thread.sleep(minOf(left, 500L))
            } catch (e: InterruptedException) {
                return
            }
            left -= 500L
        }
    }

    companion object {
        /** 前台服务通知：先试"完全不显示"的通道。 */
        const val CH_SERVICE = "lifeguard_push_service_v3"

        /** IMPORTANCE_NONE 被 ROM 拒时退到这条（MIN：静音、折叠、最底下）。 */
        const val CH_SERVICE_FALLBACK = "lifeguard_push_service_v2"

        const val CH_MESSAGES = "lifeguard_push_messages"
        const val ID_SERVICE = 2101

        /** 只有"登录已过期"这条系统类通知用固定 id。 */
        const val ID_MESSAGE = 2102

        /** 消息通知的 id 区间：管家 / 群成员分开，互不覆盖。 */
        private const val ID_AGENT_BASE = 220_000
        private const val ID_HUMAN_BASE = 320_000

        const val KEY_STATE = "push_state"
        const val KEY_WAIT_UNTIL = "push_wait_until"
        const val KEY_PUSH_ENABLED = "push_enabled"

        /** 已经发出去的消息通知 id；打开 App 时逐条撤销。 */
        const val KEY_SHOWN_IDS = "push_shown_ids"

        /** 登录票（整条 Cookie 头）。由界面读 CookieManager 后存进来。 */
        const val KEY_PUSH_COOKIE = "push_cookie"
        const val EXTRA_COOKIE = "push_cookie_extra"

        const val ACTION_RESTART = "com.lifeguard.app.action.PUSH_RESTART"

        /** 界面回到眼前：撤掉前台通知，但服务继续跑。 */
        const val ACTION_VISIBLE = "com.lifeguard.app.action.PUSH_VISIBLE"

        /** 界面离开：叫醒轮询，由它判断要不要升前台。 */
        const val ACTION_BACKGROUND = "com.lifeguard.app.action.PUSH_BACKGROUND"

        /** 这次启动必须立刻升前台（只有 startForegroundService 那条路需要）。 */
        const val EXTRA_PROMOTE = "push_promote_extra"

        fun onAppVisible(ctx: Context) {
            try {
                ctx.startService(
                    Intent(ctx, PushService::class.java).setAction(ACTION_VISIBLE)
                )
            } catch (_: Exception) {
                // 服务已经活着的话，下一次轮询也会自己看到 AppState.visible。
            }
        }

        fun onAppBackground(ctx: Context) {
            try {
                ctx.startService(
                    Intent(ctx, PushService::class.java).setAction(ACTION_BACKGROUND)
                )
            } catch (_: Exception) {}
        }

        /**
         * "在等回复"最多算多久。
         *
         * 管家可能故意不理人（lurking），也可能在跑一个很长的任务。
         * 取 10 分钟：正常回复够用，又不会因为一次"它决定不回"就挂一晚上前台服务。
         */
        private const val WAIT_TIMEOUT_MS = 10 * 60 * 1000L

        /** 闹钟兜底间隔。系统在 Doze 下只保证"大致"这个节奏。 */
        private const val WATCHDOG_MS = 15 * 60 * 1000L

        /** 人不在 App 里、也没在等回复，多久之后主动停止服务。 */
        private const val IDLE_STOP_MS = 60_000L

        /**
         * 排一个"把服务叫起来"的闹钟。同一个 PendingIntent 覆盖排，不会堆一串。
         */
        fun scheduleRestart(ctx: Context, delayMs: Long) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val pi = PendingIntent.getBroadcast(
                    ctx, ID_SERVICE,
                    Intent(ctx, RestartReceiver::class.java).setAction(ACTION_RESTART),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                val at = System.currentTimeMillis() + delayMs
                if (Build.VERSION.SDK_INT >= 23) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                } else {
                    am.set(AlarmManager.RTC_WAKEUP, at, pi)
                }
            } catch (_: Exception) {
                // 闹钟被 ROM 拦掉不是致命问题：服务本身该活还在活。
            }
        }

        /** 取消兜底闹钟（空闲待命时用）。 */
        fun cancelRestart(ctx: Context) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                val pi = PendingIntent.getBroadcast(
                    ctx, ID_SERVICE,
                    Intent(ctx, RestartReceiver::class.java).setAction(ACTION_RESTART),
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                )
                if (pi != null) {
                    am.cancel(pi)
                    pi.cancel()
                }
            } catch (_: Exception) {}
        }

        /** 打开 App 时把残留的消息通知**逐条**收掉（每个人一条，不能只撤一个 id）。 */
        fun cancelMessageNotification(ctx: Context) {
            try {
                val p = ctx.getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE)
                val nm = NotificationManagerCompat.from(ctx)
                val ids = p.getStringSet(KEY_SHOWN_IDS, emptySet()) ?: emptySet()
                for (s in ids) s.toIntOrNull()?.let { nm.cancel(it) }
                // 旧版本共用的那个固定 id 也顺手清一下。
                nm.cancel(ID_MESSAGE)
                p.edit().remove(KEY_SHOWN_IDS).apply()
            } catch (_: Exception) {
                // 没有通知权限时有些 ROM 会抛——不重要。
            }
        }
    }
}
