package com.lifeguard.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * 闹钟兜底（2026-10-21 加）。
 *
 * OriginOS 从最近任务划掉 App 时会连前台服务一起杀。代码层面能做的只有：
 * 被杀之前排一个几秒后的闹钟，让系统到点把服务再叫起来。
 *
 * ⚠️ 如果 ROM 走的是真正的 force-stop（划掉任务后 App 变成"已停止"状态），
 * 它会**连同闹钟一起清掉**，这个接收器永远不会响。那种情况只有系统的
 * 自启动/后台白名单能解决，App 自己没有任何办法。
 */
class RestartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != PushService.ACTION_RESTART) return
        val prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(PushService.KEY_PUSH_ENABLED, false)) return
        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, PushService::class.java)
                    .setAction(PushService.ACTION_BACKGROUND)
                    .putExtra(PushService.EXTRA_PROMOTE, true)
            )
        } catch (_: Exception) {
            // Android 12+ 的后台前台服务限制；下个闹钟再试。
        }
    }
}
