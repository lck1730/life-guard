package com.lifeguard.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * 开机 / 应用更新之后把提醒服务接上。
 *
 * 只在**这台机器确实登录过**（`push_enabled`）时才启动——否则每次重启
 * 都会白起一个后台服务，而用户可能还没登录。
 *
 * 部分国产 ROM 会拦截开机广播或禁止此时起前台服务。这里全部吞掉：
 * 用户下次打开 App 时 `MainActivity` 会再起一次，不会因此坏掉。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        val prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(PushService.KEY_PUSH_ENABLED, false)) return

        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, PushService::class.java)
                    .setAction(PushService.ACTION_BACKGROUND)
                    .putExtra(PushService.EXTRA_PROMOTE, true)
            )
        } catch (e: Exception) {
            // 起不来就算了——打开 App 时会再试一次。
        }
    }
}
