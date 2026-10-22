package com.lifeguard.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * 生活管家的安卓外壳。
 *
 * **界面全在服务器上**（HTML/JS）。这个壳只做四件事：
 *   1. 记住服务器地址
 *   2. 开 WebView 加载它
 *   3. **把系统 inset 数字报给网页**（状态栏多高、键盘多高）
 *   4. 处理返回键
 *
 * ## 为什么 inset 是"上报"而不是"自己排版"
 *
 * 早期版本在这里直接给容器加 padding —— 结果是**每调一次布局就得重装 APK**，
 * 因为排版逻辑写死在原生里了。
 *
 * 正确分工是：
 *   - 原生 = 传感器：只报告"状态栏 24px、键盘 960px"这类事实
 *   - 网页 = 排版：自己决定顶栏留多少、输入框抬多高
 *
 * 这样界面问题改网页就行，不用再让用户重装。**只有真正的系统能力
 * （推送、麦克风、相机、文件选择）才需要动这个壳。**
 */
// 必须继承 ComponentActivity —— onBackPressedDispatcher 只有它才有。
// 普通 Activity 拿不到返回手势的统一入口。
class MainActivity : androidx.activity.ComponentActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private var web: WebView? = null
    private lateinit var root: FrameLayout

    /** 最近一次收到的 inset。网页可能在首次派发之后才加载完，需要能主动来拉。 */
    @Volatile private var lastInsets = "{\"top\":0,\"bottom\":0,\"keyboard\":0}"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        root = FrameLayout(this).apply { setBackgroundColor(BG) }
        setContentView(root)

        // 声明"我自己处理 insets"，否则系统会把 IME 的值吃掉，回调里永远是 0
        WindowCompat.setDecorFitsSystemWindows(window, false)

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            val ime = insets.getInsets(WindowInsetsCompat.Type.displayCutout()).top
            val kb = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
            val bottom = maxOf(kb, nav)
            val statusTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
            val safeTop = maxOf(top, ime, statusTop)

            lastInsets = """{"top":$safeTop,"bottom":$bottom,"keyboard":$kb}"""
            deliverInsets()
            insets
        }
        root.requestApplyInsets()

        onBackPressedDispatcher.addCallback(this, backCallback)

        val saved = prefs.getString(KEY_SERVER, null)
        if (saved.isNullOrBlank()) {
            // ★ **用了默认地址，就把它记下来** ✗→✓（2026-10-07 深夜用户报的：
            //   「点击检查更新时提示还没配服务器地址」✓）。
            //   ⚠️ 原来这里只 `openUi(DEFAULT_SERVER)` ✓、**不存** ✗ →
            //      壳照常能打开 ✓，但 `KEY_SERVER` 一直是空的 ✓ →
            //      凡是读它的地方都以为"还没配地址" ✗（`checkUpdate` 就是这么被坑的 ✓）。
            //   ⚠️ 存的是**同一个常量** ✓ —— 不是"页面当前地址" ✗：
            //      那个是 8741（某个服务 ✓），存下去会把"回壳"的路也改掉 ✗ ✓。
            prefs.edit().putString(KEY_SERVER, DEFAULT_SERVER).apply()
            openUi(DEFAULT_SERVER)
        } else openUi(saved)

        // 已经登录过（Cookie 还在）就立刻把后台提醒接上。
        // 没登录也没关系：onResume / onPageFinished 里的登录监听会在登录之后自己启动。
        maybeStartPush()
    }

    /** 有网页就报给网页；还在原生设置页就自己加 padding（那页没有网页可报）。 */
    private fun deliverInsets() {
        val w = web
        if (w != null) {
            w.evaluateJavascript("window.__onInsets&&window.__onInsets($lastInsets)", null)
        } else {
            val arr = lastInsets.trim('{', '}').split(",")
                .mapNotNull { it.substringAfter(":").toIntOrNull() }
            val top = arr.getOrElse(0) { 0 }
            val bottom = arr.getOrElse(1) { 0 }
            root.setPadding(0, top, 0, bottom)
        }
    }

    // ── 原生兜底页：**网页加载不了时，这里是唯一的落脚点** ────────────────
    //
    // ★ 2026-10-06 起它不只是"填地址"，而是**服务列表 + 重试 + 手动填**。
    //
    // ## 为什么必须有一页原生的
    //
    // 界面、登录、服务选择**全在网页里**（服务器下发 ✓ 改一次秒生效 ✓）。
    // 好处是热更新；代价是**服务器连不上时，用户面前什么都没有** ✗ ——
    // 白屏，而且没法自救 ✗（连"换个服务试试"都点不到 ✗）。
    //
    // 所以这一页的职责是：**在所有网页都够不着的时候，仍然能选一个地址去连** ✓。
    // 它必须极少变 ✓（所以它才放在原生里 ✗），也正因为它极少变，
    // 它才值得占这一份"改动要重装 APK"的成本 ✓。
    //
    // 顺带解决了那个老毛病：以前"连不上"只弹一句 toast ✗，
    // 用户不知道下一步干什么 ✗。
    // ── ★ 连不上时：**后台继续重试，通了自动切过去** ✗→✓（2026-10-09 用户定的）──
    //
    //   用户原话：「没开 wireguard 连不上时直接黑屏，没有弹出那页提示，
    //   那页提示应该在本地，只要连不上就展示，同时后台继续尝试连，连上就切换，
    //   不然用户还要反复退出重进」✓。
    //
    //   · **那页提示在本地** ✓ —— 它是**原生**画的 ✓（不依赖网络 ✓），
    //     所以"连不上"这件事一定能看见 ✓，不会变成一片黑 ✓。
    //   · **后台接着试** ✓ —— 每 5 秒探一次 `/health` ✓（一个很轻的 GET ✓），
    //     通了就自动 `openUi(server)` ✓ → 用户**什么都不用做** ✓。
    //   ⚠️ 探测用 `HttpURLConnection` 而**不是**那个 WebView ✗ ——
    //      WebView 在兜底页里已经被销毁了 ✓（`showSetup` 第一句就是 `web?.destroy()` ✓），
    //      为了探活再养一个隐藏 WebView 是白花钱 ✓。
    //   ⚠️ **只在兜底页上重试** ✓：切过去了就停 ✓（`stopRetry` ✓），
    //      不然它会在后台一直探 ✓。
    private val uiHandler = Handler(Looper.getMainLooper())
    private var retryTick: Runnable? = null
    private var retryServer: String? = null

    private fun startRetry(server: String) {
        stopRetry()
        retryServer = server
        val tick = object : Runnable {
            override fun run() {
                val s = retryServer ?: return
                Thread {
                    val ok = runCatching {
                        val c = URL("$s/health").openConnection() as HttpURLConnection
                        c.connectTimeout = 3000
                        c.readTimeout = 3000
                        c.requestMethod = "GET"
                        val code = c.responseCode
                        c.disconnect()
                        code == 200
                    }.getOrDefault(false)
                    if (ok) {
                        runOnUiThread {
                            if (retryServer != null) {
                                retryServer = null
                                retryTick = null
                                openUi(s)      // 通了 → 自己切过去 ✓
                            }
                        }
                    } else {
                        uiHandler.postDelayed(this, 5000)
                    }
                }.start()
            }
        }
        retryTick = tick
        uiHandler.postDelayed(tick, 5000)
    }

    private fun stopRetry() {
        retryTick?.let { uiHandler.removeCallbacks(it) }
        retryTick = null
        retryServer = null
    }

    @SuppressLint("SetTextI18n")
    private fun showSetup(why: String? = null) {
        web?.destroy(); web = null
        root.removeAllViews()
        root.setPadding(0, 0, 0, 0)

        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(24)
            setPadding(pad, pad, pad, pad)
        }

        box.addView(TextView(this).apply {
            text = "生活管家"; textSize = 24f; setTextColor(FG)
        })

        // ★ 2026-10-07 深夜用户定的：**这一页只给一句人话，别的什么都不展示** ✗→✓ ——
        //   「我不希望用户获得那么多细节」✓、「服务列表和手动填地址都不要留，
        //     连不上服务器只提示，不做任何展示，普通用户不感知」✓。
        //
        //   ⚠️ 原来这里有：红字（带地址和内部诊断 ✗）、一句灰字说明 ✗、
        //      **三个服务按钮** ✗、**手动填地址输入框 + 连接按钮** ✗ —— 全删了 ✓。
        //   ⚠️ 代价说清楚 ✗：这一页**变成了死胡同** ✓ —— 看到它的人只能去开 WireGuard ✓，
        //      其余的事**我们自己来** ✓（浏览器、SSH，都是我们这边的路子 ✓）。
        //      这是个**有意的取舍** ✓：普通用户拿到那些按钮只会更糊涂 ✓。
        //
        //   ⚠️ **只在"真的连不上"时显示** ✗ —— 这一页也可能被别处主动打开，
        //      那时候报"连不上"是**撒谎** ✗ ✓。判据就是 `why` 有没有值 ✓。
        if (why != null) {
            box.addView(TextView(this).apply {
                text = "连接不上服务器，请检查 WireGuard 是否连接，" +
                       "如果仍然连不上请联系管理员。"
                textSize = 14f; setTextColor(DANGER)
                setPadding(0, dp(12), 0, 0)
            })
            // ★ 2026-10-09：告诉他**在自动重试** ✓ —— 不然用户会以为"卡死了" ✓，
            //   于是退出重进 ✓（他要的正是"不用反复退出重进"✓）。
            box.addView(TextView(this).apply {
                text = "正在自动重试，连上就自己进来，不用退出重进。"
                textSize = 13f; setTextColor(MUTED)
                setPadding(0, dp(8), 0, 0)
            })
            // 连不上就**一直试** ✓（见 `startRetry` 那段 ✓）
            val s = prefs.getString(KEY_SERVER, "")?.takeIf { it.isNotBlank() }
                ?: DEFAULT_SERVER
            if (s.isNotBlank()) startRetry(s)
        }

        // 滚一下：小屏手机上按钮 + 输入框会超出一屏 ✗
        val scroller = android.widget.ScrollView(this).apply { addView(box) }
        root.addView(scroller, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        deliverInsets()
    }

    // ── 加载网页界面 ─────────────────────────────────────────────────
    @SuppressLint("SetJavaScriptEnabled")
    private fun openUi(server: String) {
        stopRetry()                     // 已经在往真界面上走了 ✓，别再探了 ✓
        web?.destroy(); web = null          // 换地址重载时不销毁会漏一个 WebView
        root.removeAllViews()
        root.setPadding(0, 0, 0, 0)   // 网页那边自己处理 inset

        web = WebView(this).apply {
            setBackgroundColor(BG)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                cacheMode = WebSettings.LOAD_DEFAULT
                // ★ `useWideViewPort = true`：**让页面自己的 viewport 声明说了算** ✓
                //   （这条是对的 ✓，别动它 ✓）
                useWideViewPort = true

                // ★★ `loadWithOverviewMode` 从 true 改成 **false** ——
                //    这是"整页被缩小、字看着小、行看着空"的**真正原因** ✗。
                //
                //    它的语义是"把**整页**缩放到屏幕上" ✓ ——
                //    于是 WebView 用一个**宽视口（980）**去排版 ✓，
                //    屏幕只有 361 ✓ → 整体缩到 37% ✓。
                //    实测（让页面把 innerWidth 报回来 ✓）：vw=980 / screen=361 ✓，
                //    而且**生效的 viewport 声明都不是我们写的那份** ✗ ——
                //    WebView 在 overview 模式下会自己改写它 ✓。
                //
                //    false = 老老实实按**设备宽度**排版 ✓，不再缩放 ✓。
                //    它和 useWideViewPort=true 是标准搭配 ✓。
                //
                // ⚠️ 我在这个设置上绕了三轮 ✗（先怀疑行高、再怀疑 meta ✗）——
                //    每次都改网页 ✓，而真因在**这一行** ✓。
                //    教训：症状在网页上，不代表原因在网页里 ✗。
                loadWithOverviewMode = false
                builtInZoomControls = false
                displayZoomControls = false
                mediaPlaybackRequiresUserGesture = false
            }
            addJavascriptInterface(Bridge(), "LifeGuardNative")

            // 文件选择 / 权限在 WebChromeClient 上，不在 WebViewClient ——
            // 放错地方不会报错，只是永远不触发（踩过）。
            webChromeClient = object : android.webkit.WebChromeClient() {
                // 网页里的 <input type=file> 走到这。
                // 用 params.createIntent() 而不是自己拼 Intent——它已经带上
                // accept 类型和 capture（拍照）语义。
                override fun onShowFileChooser(
                    v: WebView,
                    cb: android.webkit.ValueCallback<Array<Uri>>,
                    params: android.webkit.WebChromeClient.FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = cb
                    return try {
                        @Suppress("DEPRECATION")
                        startActivityForResult(params.createIntent(), REQ_FILE)
                        true
                    } catch (e: Exception) {
                        fileCallback = null
                        toast("打不开文件选择器")
                        false
                    }
                }

                // getUserMedia（录音）走这里。系统权限我们自己要过了，
                // 这里对网页放行；不放行 MediaRecorder 会直接失败。
                override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                    request.grant(request.resources)
                }
            }

            webViewClient = object : WebViewClient() {
                /**
                 * 页面里的跳转：**留在 App 里**，还是**甩给系统浏览器**。
                 *
                 * ★ 2026-10-06 改：判据从"**整串前缀**"改成"**同一个 host**" ✗→✓。
                 *
                 *   原来是 `url.startsWith(server)` ✗ —— 它只在
                 *   "`server` 恰好等于你此刻在的那一页"时才成立 ✓，
                 *   而那个前提是**网页每次换页都在改 `server`**
                 *   （老的 `go()` 走 `setServer`，它会把目标地址存下来 ✓）。
                 *   也就是说 `server` 这**一个字段兼了两种意思** ✗：
                 *   既是"我们连的是哪台机器" ✓，又是"现在停在哪一页" ✗。
                 *
                 *   代价当天就来了：网页那边把换页改成**普通导航**之后 ✓
                 *   （那是为了不让"当前页"污染"服务器地址" ✓，见 shell 那边的注释 ✓），
                 *   从群聊（8741）去壳（8730）**不以 `server` 开头** ✗ →
                 *   被判成外链 ✓ → **点一下「退出登录」，Chrome 真的被打开了** ✗。
                 *
                 *   现在：**同 host 的任何端口都留在 App 里** ✓
                 *   （壳 8730 / 生活管家 8741 / 对讲机 8721 …）。
                 *   别的 host 照旧甩给系统浏览器 ✓（agent 发的外链本来就该这样 ✓）。
                 *
                 *   顺带把 `server` 还原成它唯一该有的意思：**我们连的是哪台机器** ✓。
                 *   ——和那天"一个标记兼两种用途"是同一个病 ✓，只是这次在原生里。
                 */
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    val u = r.url
                    val ours = runCatching {
                        val s = java.net.URI(server)
                        (u.scheme == "http" || u.scheme == "https") && u.host == s.host
                    }.getOrDefault(false)
                    if (ours) return false
                    try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                    return true
                }
                override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                    if (r.isForMainFrame) {
                        // ★ 落到**兜底页**，而不是只弹一句话 ✗。
                        // 弹个 toast 就完了的话，用户面前是一片空白 ✗，
                        // 既不知道该干什么，也没法换个服务试 ✗。
                        // 兜底页上有：服务列表 + 重试 + 手动填地址 ✓。
                        // 传一个非空字符串就行 —— 这一页只用它判"是不是连不上" ✓，
                        // 具体内容**不显示**给用户 ✗（细节留在日志里 ✓）。
                        showSetup("offline")
                    }
                }
                override fun onPageFinished(v: WebView, url: String) {
                    deliverInsets()   // 页面就绪后补发一次
                    ensureMicPermission()
                    // 登录之后服务器会整页跳转 → 这里会再响一次；此时 Cookie 已经
                    // 落到 CookieManager 里了，正好把后台提醒接上。
                    maybeStartPush()
                    // 顺手问一句有没有新版。**放在原生而不是网页里**：
                    // 万一是壳太旧导致页面都渲染不出来，那条路也得能打听新版
                    // ——这正是"更新通道"存在的理由。一天最多问一次，很轻。
                    checkUpdate(false)
                }
            }
            // 一次性清掉旧缓存。
            //
            // 背景：界面是"改服务器文件 = 重开 App 生效"的架构，但 WebView 会把
            // 旧 HTML 缓存住，导致改了不生效、用户以为没做（这个坑反复出现）。
            // 服务器那边已经加了 no-store 头，但**之前缓存下来的副本不受新头影响**，
            // 所以这里清一次，之后靠 no-store 保持新鲜。
            if (!prefs.getBoolean(KEY_CACHE_CLEARED, false)) {
                clearCache(true)
                prefs.edit().putBoolean(KEY_CACHE_CLEARED, true).apply()
            }

            loadUrl(server)
        }
        root.addView(web, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    /** 暴露给网页的原生能力。**只读为主**——能力越少，壳改动越少。 */
    inner class Bridge {
        @JavascriptInterface
        fun insets(): String = lastInsets

        /** 网页切主题时通知原生，好同步状态栏图标的明暗。 */
        @JavascriptInterface
        fun setLightStatusBar(light: Boolean) {
            runOnUiThread {
                androidx.core.view.WindowInsetsControllerCompat(window, root)
                    .isAppearanceLightStatusBars = light
            }
        }

        @JavascriptInterface
        fun isNative(): Boolean = true

        /** 网页每次切界面都报一下。原生靠它决定返回键该"退回聊天"还是"退出应用"。 */
        @JavascriptInterface
        fun setScreen(name: String) {
            currentScreen = name
        }

        /**
         * 网页可以自己放一个"检查更新"入口，点了调这个。
         *
         * 这样**管家能自己给 App 加一个更新按钮**（它写 ui/app.js 就行），
         * 不用为此再动一次壳。
         */
        @JavascriptInterface
        fun checkUpdate() {
            runOnUiThread { this@MainActivity.checkUpdate(true) }
        }

        /** 当前壳的版本名，网页要显示"v0.3.0"之类的可以用它。 */
        @JavascriptInterface
        fun appVersion(): String =
            try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

        // ── 服务器地址：让"走错门"这件事变成可切换的功能 ────────────────
        //
        // 起因：2026-10-04 用户把地址填成了对讲机那个端口（8721），
        // 于是 App 里显示的是应急通道。当时唯一的出路是"让页面加载失败 →
        // 弹原生设置页"——又绕，还得先关掉 VPN 才能制造失败。
        //
        // 所以把地址这件事**开放给网页**：
        //   · 管家的设置页可以放一个「服务器地址」入口（`openSetup()`）
        //   · 对讲机的页面发现自己在 App 里，就能挂一条「回到管家」
        //     （`setServer()`）——**这正好也是用户想要的用法**：
        //     管家那套崩了，不用开浏览器，在 App 里切到对讲机就行。

        /**
         * 网页问："这台设备上，我现在有登录态吗？"
         *
         * ## 为什么需要它
         *
         * 登录令牌住在 **httpOnly Cookie** 里——**网页里的 JS 读不到** ✓（这正是
         * 我们能放心让 agent 写 `ui/app.js` 的前提）。但代价是：网页也就**没法
         * 自己判断**"登录了没"，只能打一次 `/auth/me` 问服务器；而在等回话的
         * 那几百毫秒里它总得显示点什么，于是已登录的人也会看到登录页**闪一下** ✗
         *
         * **原生 API 不受 httpOnly 限制**（那个限制只压在网页的 JS 上），
         * 所以壳读得到。这里**只说有没有、不说值** —— 网页据此本地判断（不闪了），
         * 但**令牌一个字都不进网页** ✓ 地基还在 ✓
         *
         * （实测依据：现代 WebView 的 `CookieManager.getCookie()` 会返回 httpOnly
         *   cookie；API ≤ 28 的老 WebView 有返回 null 的已知坑，但那时网页会退回
         *   "问服务器"的老路，只是又闪一下而已，不会坏。我们的 cookie 不是 Secure，
         *   正好避开那个坑的主要触发条件。）
         */
        @JavascriptInterface
        fun hasSession(): Boolean = lifeguardCookie() != null

        /** 打开原生的服务器地址设置页。 */
        // 这里原来有个 `openSetup()`（网页让我们弹"换地址"那页）。**删了** ✗→✓ ——
        // 那一页现在只剩一句"连不上服务器" ✓，网页点它只会得到一块近乎空白的屏 ✓。
        // 而且查过：**没有任何页面在调它** ✓（包括壳自己 ✓）。
        @JavascriptInterface
        fun openSetupDeprecated() {
            runOnUiThread { showSetup(prefs.getString(KEY_SERVER, "")) }
        }

        /** 现在连的是哪个地址。 */
        @JavascriptInterface
        fun serverUrl(): String = prefs.getString(KEY_SERVER, "") ?: ""

        /** 换地址并立刻重载。给"走错门"和"管家崩了切对讲机"两件事用。 */
        @JavascriptInterface
        fun setServer(url: String) {
            val u = url.trim()
            if (u.isEmpty() || !u.startsWith("http")) return
            prefs.edit().putString(KEY_SERVER, u).apply()
            runOnUiThread { openUi(u) }
        }

        // ── 存图片 ──────────────────────────────────────────────────────

        /**
         * ★ **把聊天里的一张图存进系统相册** ✗→✓（2026-10-11 用户：「需要保存」）。
         *
         * ## 为什么这条只能原生做
         *
         * 网页侧两条路都堵着 ✓：
         *   · `/media` **要同源 cookie** ✓（2026-10-08 加的鉴权 ✓）→
         *     把链接丢给外部浏览器会 401 ✗；
         *   · WebView 里的 `<a download>` / `blob:` 下载**没有任何下载器接着** ✗
         *     （我们**没设** setDownloadListener ✓）。
         * 而壳这一侧两样都现成 ✓：CookieManager 拿得到那张 httpOnly 的票 ✓
         * （hasSession 早就在用同一个办法 ✓）、MediaStore 写得到相册 ✓。
         *
         * ## 为什么自己再下一次，不用 WebView 缓存里那份
         *
         * **取不到** ✗ —— 页面加载过的资源在 WebView 的缓存里 ✓，原生没有一条路读它 ✓。
         * 所以拿 URL 自己下一次 ✓，带上和网页同一份 cookie ✓
         * （服务器那边看起来就是同一个人 ✓）。
         *
         * ## 为什么写 MediaStore
         *
         * API 29+ **不许**直接写公共目录 ✓；走 MediaStore 就**不用任何权限** ✓ ——
         * 所以 AndroidManifest **一行都不用加** ✓。
         * ⚠️ minSdk 是 26 ✓：26~28 那条腿做不到 ✓（要运行时申请
         *   WRITE_EXTERNAL_STORAGE ✓）→ 那种机器上**明说做不到** ✓，
         *   绝不装作存成功了 ✗（"看着成功、其实没有"是最坏的一种 ✓）。
         */
        @JavascriptInterface
        fun saveImage(url: String) {
            val base = (prefs.getString(KEY_SERVER, "") ?: "").trimEnd('/')
            // ⚠️ **只认自己服务器上的 `/media/`** ✗ —— 这个参数是从网页来的 ✓，
            //   而网页有一部分是 **agent 写的**（ui/app.js ✓）→
            //   不设防的话它就能让壳带着**用户的 cookie** 去取任意 URL ✓
            //   （取回来存进相册 ✓、拿不回去 ✓，所以不是什么大洞 ✓ ——
            //    但**白名单比"想想它能不能被利用"可靠** ✓，这个项目的老规矩 ✓）。
            if (!base.startsWith("http") || !url.startsWith("$base/media/")) {
                runOnUiThread { toast("只能保存聊天里的图片") }
                return
            }
            Thread {
                // ⚠️ **写成 `try` 表达式** ✗→✓（第一次编译就撞上）——
                //    `val msg: String` 然后在 try / catch 里各赋一次，
                //    **Kotlin 编译不过** ✓（它证明不了"任何一条路径上只赋了一次"✓）。
                //    `try` 本身就能当表达式用 ✓，这样反而更直白 ✓。
                val msg = try {
                    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 10_000
                        readTimeout = 30_000
                        // ★ **就是这一句让 `/media` 放行** ✓（和 hasSession 同一个办法 ✓）
                        android.webkit.CookieManager.getInstance().getCookie(url)
                            ?.let { setRequestProperty("Cookie", it) }
                    }
                    if (conn.responseCode != 200) throw Exception("服务器返回 ${conn.responseCode}")
                    val bytes = conn.inputStream.use { it.readBytes() }
                    if (bytes.isEmpty()) throw Exception("取到的是空文件")

                    val ext = url.substringAfterLast('/', "")
                        .substringAfterLast('.', "jpg").take(4).lowercase()
                        .let { if (it in listOf("png", "webp", "gif", "jpg", "jpeg")) it else "jpg" }
                    val mime = when (ext) {
                        "png" -> "image/png"
                        "webp" -> "image/webp"
                        "gif" -> "image/gif"
                        else -> "image/jpeg"
                    }
                    if (android.os.Build.VERSION.SDK_INT < 29) {
                        throw Exception(
                            "这台安卓（${android.os.Build.VERSION.RELEASE}）要开存储权限才存得进去，暂时存不了")
                    }
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                            "lifeguard_${System.currentTimeMillis()}.$ext")
                        put(android.provider.MediaStore.Images.Media.MIME_TYPE, mime)
                        put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/LifeGuard")
                        put(android.provider.MediaStore.Images.Media.IS_PENDING, 1)
                    }
                    val uri = contentResolver.insert(
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        ?: throw Exception("相册没接受这个文件")
                    try {
                        contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                            ?: throw Exception("写不进去")
                    } catch (e: Exception) {
                        contentResolver.delete(uri, null, null)   // ★ 别在相册里留半张坏图 ✓
                        throw e
                    }
                    values.clear()
                    values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0)
                    contentResolver.update(uri, values, null, null)
                    "已存到相册（Pictures/LifeGuard）"
                } catch (e: Exception) {
                    "没存上：${e.message ?: "未知原因"}"
                }
                // ⚠️ **Toast 必须在主线程** ✗ —— 这是安卓的硬规矩 ✓（别的线程直接调会崩 ✓）
                runOnUiThread { toast(msg) }
            }.start()
        }

        // ── 拍照 / 录音 ────────────────────────────────────────────────
        //
        // **为什么不用网页那套**：
        //   · `<input type=file capture>` 在 MIUI 上被忽略，拍照会变成开相册；
        //   · `getUserMedia` 只在安全上下文（HTTPS / localhost）可用，
        //     而我们走的是 http://局域网IP —— 浏览器压根不提供录音 API。
        // 所以这两件事只能落到原生。

        @JavascriptInterface
        fun takePhoto() {
            runOnUiThread {
                try {
                    val dir = File(cacheDir, "cam").apply { mkdirs() }
                    val f = File(dir, "shot_${System.currentTimeMillis()}.jpg")
                    photoFile = f
                    val uri = androidx.core.content.FileProvider.getUriForFile(
                        this@MainActivity, "$packageName.fileprovider", f)
                    val intent = Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
                        putExtra(android.provider.MediaStore.EXTRA_OUTPUT, uri)
                        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    }
                    @Suppress("DEPRECATION")
                    startActivityForResult(intent, REQ_PHOTO)
                } catch (e: Exception) {
                    toast("打不开相机")
                    js("window.__onPhoto&&window.__onPhoto(null)")
                }
            }
        }

        @JavascriptInterface
        fun startRecord() {
            runOnUiThread {
                try {
                    val dir = File(cacheDir, "voice").apply { mkdirs() }
                    val f = File(dir, "rec_${System.currentTimeMillis()}.m4a")
                    voiceFile = f
                    val r = if (android.os.Build.VERSION.SDK_INT >= 31)
                        android.media.MediaRecorder(this@MainActivity)
                    else @Suppress("DEPRECATION") android.media.MediaRecorder()
                    r.setAudioSource(android.media.MediaRecorder.AudioSource.MIC)
                    r.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4)
                    r.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC)
                    r.setAudioSamplingRate(16000)
                    r.setAudioEncodingBitRate(32000)
                    r.setOutputFile(f.absolutePath)
                    r.prepare()
                    r.start()
                    voiceRecorder = r
                    recordStartAt = System.currentTimeMillis()
                    js("window.__onRecState&&window.__onRecState(true)")
                } catch (e: Exception) {
                    toast("录音启动失败")
                    js("window.__onVoice&&window.__onVoice(null)")
                }
            }
        }

        @JavascriptInterface
        fun stopRecord() {
            runOnUiThread {
                val r = voiceRecorder ?: return@runOnUiThread
                voiceRecorder = null
                val secs = ((System.currentTimeMillis() - recordStartAt) / 1000).toInt()
                try { r.stop() } catch (_: Exception) {}
                try { r.release() } catch (_: Exception) {}
                val f = voiceFile
                if (f == null || !f.exists() || secs < 1) {
                    js("window.__onVoice&&window.__onVoice(null)")
                    return@runOnUiThread
                }
                val b64 = android.util.Base64.encodeToString(
                    f.readBytes(), android.util.Base64.NO_WRAP)
                f.delete()
                js("window.__onVoice&&window.__onVoice('$b64','audio/mp4',$secs)")
            }
        }
    }

    // ── 拍照/录音的收尾 ───────────────────────────────────────────────

    /** evaluateJavascript 的简写。注意：JS 里收到 null 时走"失败"分支。 */
    private fun js(code: String) {
        web?.evaluateJavascript(code, null)
    }

    private fun finishPhoto() {
        val f = photoFile
        photoFile = null
        if (f == null || !f.exists() || f.length() == 0L) {
            js("window.__onPhoto&&window.__onPhoto(null)")
            return
        }
        // 原图动辄几 MB，base64 之后还要再涨 1/3，传进 JS 既慢又占内存。
        // 先缩到长边 1600 再编码——发朋友圈也够清楚了。
        val bitmap = android.graphics.BitmapFactory.decodeFile(f.absolutePath)
        val scaled = bitmap?.let {
            val max = maxOf(it.width, it.height)
            if (max <= 1600) it else {
                val k = 1600f / max
                android.graphics.Bitmap.createScaledBitmap(
                    it, (it.width * k).toInt(), (it.height * k).toInt(), true)
            }
        }
        val buf = java.io.ByteArrayOutputStream()
        scaled?.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, buf)
        scaled?.recycle()
        f.delete()
        val b64 = android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP)
        js("window.__onPhoto&&window.__onPhoto('$b64','image/jpeg')")
    }

    // ── 返回 ──────────────────────────────────────────────────────────
    //
    // 用 OnBackPressedDispatcher 而不是 onKeyDown：全面屏手势导航下，
    // 返回手势不一定会走 key 事件，只有这个调度器是可靠入口。
    //
    // 网页里的"设置页"和"聊天页"是同一个 HTML 页面里的两个视图，
    // WebView 历史里没有记录 —— 所以不能靠 canGoBack 判断，
    // 得让网页告诉原生当前在哪个界面。
    private val backCallback = object : androidx.activity.OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val w = web
            if (w == null) { finish(); return }        // 地址设置页 → 直接退
            if (currentScreen == SCREEN_SETTINGS) {
                // 设置页 → 交回网页，让它滑回聊天
                w.evaluateJavascript("window.__goBack&&window.__goBack()", null)
                return
            }
            // 主界面 → 再按一次才退出
            val now = System.currentTimeMillis()
            if (now - lastBackAt < 2000) {
                finish()
            } else {
                lastBackAt = now
                toast("再滑一次退出")
            }
        }
    }

    private var currentScreen = SCREEN_CHAT
    private var lastBackAt = 0L

    // ── 文件选择 / 麦克风权限 ─────────────────────────────────────────

    private var fileCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    // 拍照 / 录音的中间状态
    private var photoFile: java.io.File? = null
    private var voiceFile: java.io.File? = null
    private var voiceRecorder: android.media.MediaRecorder? = null
    private var recordStartAt = 0L

    /** 下好、等着装的那个 APK。用户去授权"允许安装应用"回来之后还要接着装它。 */
    private var pendingApk: java.io.File? = null

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            fileCallback?.onReceiveValue(
                android.webkit.WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        if (requestCode == REQ_INSTALL_SRC) {
            // 从"允许安装应用"的授权页回来了。授了就接着装，没授就安静放弃
            // （不弹错误——用户明确说了"不要"，再念一遍很烦）。
            val f = pendingApk
            if (f != null) installApk(f)
            return
        }
        if (requestCode == REQ_PHOTO) {
            if (resultCode == RESULT_OK) finishPhoto()
            else { photoFile?.delete(); photoFile = null
                   js("window.__onPhoto&&window.__onPhoto(null)") }
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    /** 录音权限。只在没有的时候要一次——语音是核心功能，这一个是值得的。 */
    private fun ensureMicPermission() {
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.RECORD_AUDIO)
            == android.content.pm.PackageManager.PERMISSION_GRANTED) return
        androidx.core.app.ActivityCompat.requestPermissions(
            this, arrayOf(android.Manifest.permission.RECORD_AUDIO), REQ_MIC)
    }

    // ── 后台消息提醒（2026-10-21） ─────────────────────────────────────
    //
    // 轮询本身在 `PushService`（原生，和网页无关）。这一边只做三件事：
    //   1. 判断有没有登录态——Cookie 是 httpOnly 的，网页读不到，原生读得到
    //   2. 登录之后把服务叫起来。登录走的是 fetch，**不一定触发 onPageFinished**，
    //      所以这里还要盯一段时间 Cookie
    //   3. 告诉服务"我正停在前台"，别在他眼前重复弹已经看到的回复
    //
    // ★ 为什么不在网页里加钩子：这个能力属于"系统能力"，
    //   网页是服务器下发的、随时会变；壳变了才需要重装 APK。
    //   放在原生里，网页一行都不用改。

    private var loginWatchTries = 0
    private val loginWatch = object : Runnable {
        override fun run() {
            if (!AppState.visible) return
            if (lifeguardCookie() != null) { maybeStartPush(); return }
            if (loginWatchTries++ >= 300) return     // 盯 10 分钟，够登录了
            uiHandler.postDelayed(this, 2000)
        }
    }

    override fun onResume() {
        super.onResume()
        AppState.visible = true
        // 人已经进来了：刚才那条通知没有意义了（网页会自己 catchUp）。
        PushService.cancelMessageNotification(this)
        // ★ 人看得见的时候服务只做普通服务，不升前台、不挂常驻通知。
        //   先无条件撤一次：哪怕这会儿还没读到登录票，也不能让上一版/开机
        //   留下的那条「后台提醒已开启」继续挂着。
        PushService.onAppVisible(this)
        maybeStartPush()
        watchLogin()
    }

    override fun onPause() {
        AppState.visible = false
        super.onPause()
        // 提一下服务：下一次轮询就会按"他看不见了"重新判断要不要升前台。
        // Android 12+ 在真后台可能拒绝这次 startService —— 里面已经吞掉；
        // 服务本来就在跑，拒绝也不影响轮询。
        PushService.onAppBackground(this)
    }

    // 划掉最近任务 / 被系统收走时，onStop 比 onPause 更接近"人真的不看了"。
    override fun onStop() {
        AppState.visible = false
        super.onStop()
    }

    /** 当前登录票（整条 Cookie 头）。名字必须和 `app/auth.py` 的 SESSION_COOKIE 一致。 */
    private fun lifeguardCookie(): String? {
        return try {
            val base = prefs.getString(KEY_SERVER, null) ?: return null
            val c = android.webkit.CookieManager.getInstance().getCookie(base)
                ?: return null
            // ⚠️ 名字要和「壳」发的那张票一致 ✗ —— 2026-10-06 从 lg_session 改成了
            // lg_shell_session（每个服务各自的 cookie 名 ✓，同名会把别的服务顶下线 ✗）。
            if (c.contains("$COOKIE_NAME=")) c else null
        } catch (e: Exception) {
            null
        }
    }

    private fun maybeStartPush() {
        // ★ 票由界面这一层读，**存下来再交给服务**：
        //   服务在后台线程里自己调 CookieManager，可能一直读不到票 →
        //   服务活着却永远不轮询，表现就是"没有任何报错、也永远不提醒"。
        val cookie = lifeguardCookie() ?: return
        ensureNotifPermission()
        try { android.webkit.CookieManager.getInstance().flush() } catch (_: Exception) {}
        prefs.edit()
            .putBoolean(PushService.KEY_PUSH_ENABLED, true)
            .putString(PushService.KEY_PUSH_COOKIE, cookie)
            .apply()
        try {
            // ★ 普通 startService，不是 startForegroundService：
            //   界面在前台时不需要前台服务，也就不需要那条常驻通知。
            //   等服务轮询到"有人在等回复、而他已经离开"时，自己升前台。
            startService(
                Intent(this, PushService::class.java)
                    .setAction(PushService.ACTION_VISIBLE)
                    .putExtra(PushService.EXTRA_COOKIE, cookie)
            )
        } catch (_: Exception) {
            // Android 12+ 的后台启动限制 / 部分 ROM 的拦截。
            // 下次回到前台会再试；不弹错误。
        }
        maybeAskUnrestrictedBattery()
    }

    /** 一次性问一句"允许后台运行"。国产 ROM 上这比代码管用。 */
    private fun maybeAskUnrestrictedBattery() {
        if (android.os.Build.VERSION.SDK_INT < 23) return
        if (prefs.getBoolean(KEY_BATTERY_ASKED, false)) return
        val pm = getSystemService(android.os.PowerManager::class.java) ?: return
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        prefs.edit().putBoolean(KEY_BATTERY_ASKED, true).apply()
        AlertDialog.Builder(this)
            .setTitle("让提醒能在后台活着")
            .setMessage("系统默认会限制后台运行。允许生活管家不受电池优化限制之后，" +
                    "人不在 App 里时才更容易收到「管家回了」。")
            .setPositiveButton("去允许") { _, _ ->
                try {
                    startActivity(
                        Intent(
                            android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:$packageName")
                        )
                    )
                } catch (_: Exception) {
                    try {
                        startActivity(
                            Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        )
                    } catch (_: Exception) {}
                }
            }
            .setNegativeButton("以后", null)
            .show()
    }

    /** Android 13+ 的通知权限。只问一次，别每次开 App 都弹。 */
    private fun ensureNotifPermission() {
        if (android.os.Build.VERSION.SDK_INT < 33) return
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) return
        if (prefs.getBoolean(KEY_NOTIF_ASKED, false)) return
        prefs.edit().putBoolean(KEY_NOTIF_ASKED, true).apply()
        androidx.core.app.ActivityCompat.requestPermissions(
            this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
    }

    private fun watchLogin() {
        uiHandler.removeCallbacks(loginWatch)
        if (lifeguardCookie() != null) { maybeStartPush(); return }
        loginWatchTries = 0
        uiHandler.postDelayed(loginWatch, 1500)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_NOTIF) return
        val granted = grantResults.isNotEmpty() &&
                grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (granted) maybeStartPush()
        else toast("不开通知权限的话，后台有新回复也不会响")
    }

    override fun onDestroy() {
        AppState.visible = false
        uiHandler.removeCallbacks(loginWatch)
        stopRetry()
        web?.destroy(); web = null
        // ★ 不 stop PushService：划掉 App / 退出界面之后提醒还得继续。
        super.onDestroy()
    }

    // ── 应用内更新 ────────────────────────────────────────────────────
    //
    // **界面能热更新（服务器换个文件就行），壳不能** —— 壳编译在你手机里。
    // 所以壳的改动只能"重装一个 APK"，而以前那意味着连电脑。这条路把它接上：
    //
    //   服务器放一份 APK + 版本号  →  开 App 时问一句有没有新版
    //   →  弹窗说清改了什么  →  下载  →  交给**系统安装器**
    //
    // 最后一步必须由你点确认：Android 不允许应用静默安装自己（那要设备管理员，
    // 自用没必要）。所以省掉的是"连电脑"，不是"确认"。

    /** 当前壳的版本号。用 PackageManager 而不是 BuildConfig——不用为此开 buildFeatures。 */
    private fun appVersionCode(): Long {
        val pi = packageManager.getPackageInfo(packageName, 0)
        return if (android.os.Build.VERSION.SDK_INT >= 28) pi.longVersionCode
               else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }

    /**
     * 问服务器有没有新版。
     *
     * `manual=true` 是用户主动点的（"检查更新"），那就有话直说：
     * 最新 / 失败 / 有新版。自动检查则安静得多，一天最多问一次。
     */
    fun checkUpdate(manual: Boolean) {
        val base = prefs.getString(KEY_SERVER, null)
        if (base.isNullOrBlank()) {
            if (manual) toast("还没配服务器地址")
            return
        }
        // ★ **每次启动都问一次，而且不再"12 小时节流"。**
        //
        // 原来那版写的是"12 小时内查过就不再查"——本意是别老打扰用户。
        // 但它恰好把最要紧的场合挡住了：**我刚发了一版、想让你装上**的时候，
        // 12 小时节流让你什么都看不到（2026-10-04 实测就是这么被挡的）。
        //
        // 正确的做法是**按版本记，不按时间记**：同一版你点了"以后再说"
        // 就不再弹；一旦有新的一版，照样弹。请求很小，每次启动问一次不心疼。
        val skip = prefs.getLong(KEY_UPDATE_SKIP, 0L)
        Thread {
            val info = try { fetchLatest(base) } catch (e: Exception) { null }
            runOnUiThread {
                if (info == null) {
                    if (manual) toast("检查更新失败（连不上服务器？）")
                    return@runOnUiThread
                }
                val remote = info.optLong("versionCode", 0L)
                if (remote <= appVersionCode()) {
                    if (manual) toast("已经是最新版了（v" + info.optString("versionName", "?") + "）")
                    return@runOnUiThread
                }
                // ★ **最低版本**（2026-10-06 加）。
                //
                // 上面那套"以后再说"是按版本记的 ✓，正常情况够用 ✓。
                // 但它挡不住一种情况 ✗：**原生这边的约定变了** ✗ ——
                // 比如 cookie 名从 lg_session 换成 lg_shell_session ✓
                // （这次重构正好撞上 ✓）。
                // 那时候旧壳不是"有点旧" ✗，而是**和新服务器对不上** ✗：
                // 用户点了"以后再说"，就会一直停在一个半坏的状态里 ✗，
                // 而且他完全没有理由知道该升级 ✗。
                //
                // 所以服务端可以声明 `minVersion` ✓：低于它**强制更新** ✓，
                // 没有"以后再说"这个选项 ✓。
                val minV = info.optLong("minVersion", 0L)
                val forced = minV > 0 && appVersionCode() < minV
                val url = info.optString("url", "")
                if (url.isBlank()) {
                    if (manual) toast("新版信息不完整，让管家看看 releases/latest.json")
                    return@runOnUiThread
                }
                if (!forced && !manual && remote <= skip) return@runOnUiThread  // 这版他说过"以后再说"
                val notes = info.optString("notes", "")
                val b = AlertDialog.Builder(this)
                    .setTitle(if (forced) "需要更新才能继续" else "有新版本 " + info.optString("versionName", ""))
                    .setMessage(if (notes.isBlank()) "要现在下载安装吗？" else notes)
                    .setPositiveButton(if (forced) "下载安装（必须）" else "下载安装") { _, _ -> downloadAndInstall(url) }
                if (!forced) {
                    b.setNegativeButton("以后再说") { _, _ ->
                        // 记下"这一版他说不要"——下一版还会弹，同一版不再烦他
                        prefs.edit().putLong(KEY_UPDATE_SKIP, remote).apply()
                    }
                }
                b.setCancelable(!forced).show()
            }
        }.start()
    }

    /**
     * 把「当前连着的地址」换成「壳的地址」。
     *
     * 这是 2026-10-06 那次「检查更新说连不上服务器」的原因：
     *
     * 更新通道（`/api/app/latest` 和 `releases` 目录）挂在**壳**（8730）上 ——
     * 因为 APK 默认连的就是壳，而问更新的动作必须和入口在一起。
     *
     * 但用户可能正连着生活管家（8741）：那个服务里**没有** releases 目录，
     * 问它就是 404，而 404 在 fetchLatest 里表现为**抛异常**，
     * 于是提示成「连不上服务器」—— 看着像网络问题，其实是问错了人。
     *
     * 所以：**只换端口，不换主机**。主机是用户自己的网络环境，端口是我们定的约定。
     */
    private fun shellBase(base: String): String {
        return try {
            val u = java.net.URI(base.trimEnd('/'))
            val host = u.host ?: return base
            "http://" + host + ":" + SHELL_PORT
        } catch (e: Exception) { base }
    }

    private fun fetchLatest(base: String): org.json.JSONObject {
        val c = (java.net.URL(shellBase(base).trimEnd('/') + "/api/app/latest")
            .openConnection() as java.net.HttpURLConnection).apply {
            connectTimeout = 8000
            readTimeout = 8000
        }
        try {
            c.inputStream.bufferedReader().use { return org.json.JSONObject(it.readText()) }
        } finally {
            c.disconnect()
        }
    }

    private fun downloadAndInstall(apkUrl: String) {
        val dlg = AlertDialog.Builder(this)
            .setTitle("正在下载新版本…")
            .setMessage("下载完会让你确认安装。")
            .setCancelable(false)
            .create()
        dlg.show()
        Thread {
            val dest = File(File(filesDir, "update").apply { mkdirs() }, "lifeguard.apk")
            val ok = try {
                // 服务端给相对地址，这样换隧道地址时不用改 releases 里的内容
                val full = if (apkUrl.startsWith("http")) apkUrl
                           else (prefs.getString(KEY_SERVER, "") ?: "").trimEnd('/') + apkUrl
                val c = (java.net.URL(full).openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 10000
                    readTimeout = 120000
                }
                c.inputStream.use { ins -> java.io.FileOutputStream(dest).use { ins.copyTo(it) } }
                c.disconnect()
                dest.length() > 0
            } catch (e: Exception) {
                false
            }
            runOnUiThread {
                dlg.dismiss()
                if (!ok) { toast("下载失败，再试一次"); return@runOnUiThread }
                installApk(dest)
            }
        }.start()
    }

    private fun installApk(f: File) {
        pendingApk = f
        // Android 8+：装别的来源要先授权一次。没授就带他去授权，回来接着装。
        if (android.os.Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            toast("要允许「生活管家」安装应用，授权后会自动继续")
            startActivityForResult(
                Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                       Uri.parse("package:$packageName")), REQ_INSTALL_SRC)
            return
        }
        pendingApk = null
        try {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this, "$packageName.fileprovider", f)
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        } catch (e: Exception) {
            toast("打不开安装器：" + (e.message ?: ""))
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_LONG).show()

    companion object {
        /** App 私有 prefs。PushService / 两个 Receiver 也读这一份。 */
        internal const val PREFS = "lifeguard"

        internal const val KEY_SERVER = "server"

        /** 壳的端口。改它要连网页那份一起改（index.html 里的 backToShell）。 */
        private const val SHELL_PORT = "8730"

        /**
         * 默认连「壳」（8730）—— 它是整个系统的入口。
         *
         * 为什么要有默认值：没有它，新装的 App 第一屏是一个**空白的填地址框**，
         * 用户（尤其不是你本人）看到那个只会以为 App 坏了。
         * 填错也不要紧：连不上会落到兜底页，那页上能改。
         */
        internal const val DEFAULT_SERVER = "http://10.66.66.1:8730"

        /** 登录票的 Cookie 名。必须和服务端 `app/auth.py` 的 SESSION_COOKIE 一致。 */
        internal const val COOKIE_NAME = "lg_shell_session"

        // 网页上报的界面名。原生靠它决定返回键怎么走。
        private const val SCREEN_CHAT = "chat"
        private const val SCREEN_SETTINGS = "settings"

        private const val REQ_FILE = 1001
        private const val REQ_MIC = 1002
        private const val REQ_PHOTO = 1003
        private const val KEY_UPDATE_SKIP = "update_skipped_code"
        private const val REQ_INSTALL_SRC = 1004
        private const val REQ_NOTIF = 1005
        private const val KEY_CACHE_CLEARED = "cache_cleared_v1"
        private const val KEY_BATTERY_ASKED = "battery_asked_v1"
        private const val KEY_NOTIF_ASKED = "notif_asked_v1"
        private val BG = Color.parseColor("#0F1115")
        private val FG = Color.parseColor("#E6E8EE")
        private val MUTED = Color.parseColor("#8B93A7")
        private val PANEL = Color.parseColor("#1E222B")
        private val ACCENT = Color.parseColor("#6EA8FF")
        // 和网页那套 token 里的 --danger 同一个色 ✓（连不上、失败才用它）
        private val DANGER = Color.parseColor("#FF6B6B")
    }
}
