package com.engx.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen widget backed only by the last snapshot written by EngXWidgetsPlugin. */
public class EngXWidgetProvider extends AppWidgetProvider {
    private static final int REQUEST_HOME = 4101;
    private static final int REQUEST_NEW_ORDER = 4102;
    private static final int REQUEST_SCAN = 4103;
    private static final int REQUEST_NOTIFICATIONS = 4104;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) updateWidget(context, manager, widgetId);
    }

    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, EngXWidgetProvider.class));
        for (int id : ids) updateWidget(context, manager, id);
    }

    private static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_engx);
        JSONObject snapshot = readSnapshot(context);
        boolean enabled = snapshot.optBoolean("enabled", false);
        String domain = snapshot.optString("domain", "medical");
        JSONObject counts = snapshot.optJSONObject("counts");
        views.setTextViewText(R.id.widget_open_orders, count(enabled, counts, "openOrders"));
        views.setTextViewText(R.id.widget_pm_due, count(enabled, counts, "pmDue"));
        views.setTextViewText(R.id.widget_cal_due, count(enabled, counts, "calDue"));
        views.setTextViewText(R.id.widget_low_stock, count(enabled, counts, "lowStock"));
        views.setTextViewText(R.id.widget_pending, count(enabled, counts, "pendingApprovals"));
        views.setTextViewText(R.id.widget_status, enabled ? "ملخص القسم الحالي" : "افتح EngX لتفعيل الودجت");
        String updatedAt = enabled ? snapshot.optString("updatedAt", "") : "";
        views.setTextViewText(R.id.widget_updated, updatedAt.isEmpty() ? "آخر تحديث: —" : "آخر تحديث: " + updatedAt);

        JSONArray items = enabled ? snapshot.optJSONArray("items") : null;
        int[] rowIds = {R.id.widget_item_1, R.id.widget_item_2, R.id.widget_item_3};
        int[] titleIds = {R.id.widget_item_1_title, R.id.widget_item_2_title, R.id.widget_item_3_title};
        int[] dateIds = {R.id.widget_item_1_date, R.id.widget_item_2_date, R.id.widget_item_3_date};
        for (int i = 0; i < rowIds.length; i++) {
            JSONObject item = items == null ? null : items.optJSONObject(i);
            boolean visible = item != null && !item.optString("label", "").isEmpty();
            views.setViewVisibility(rowIds[i], visible ? View.VISIBLE : View.GONE);
            if (visible) {
                views.setTextViewText(titleIds[i], item.optString("label", ""));
                views.setTextViewText(dateIds[i], item.optString("date", ""));
                String uri = item.optString("uri", "");
                if (!uri.isEmpty()) views.setOnClickPendingIntent(rowIds[i], deepLink(context, uri, 4200 + i));
            }
        }
        views.setOnClickPendingIntent(R.id.widget_root, deepLink(context, "engx://home?domain=" + Uri.encode(domain), REQUEST_HOME));
        views.setOnClickPendingIntent(R.id.widget_new_order, deepLink(context, "engx://new-order?domain=" + Uri.encode(domain), REQUEST_NEW_ORDER));
        views.setOnClickPendingIntent(R.id.widget_scan, deepLink(context, "engx://scan?domain=" + Uri.encode(domain), REQUEST_SCAN));
        views.setOnClickPendingIntent(R.id.widget_notifications, deepLink(context, "engx://notifications?domain=" + Uri.encode(domain), REQUEST_NOTIFICATIONS));
        manager.updateAppWidget(widgetId, views);
    }

    private static String count(boolean enabled, JSONObject counts, String key) {
        return String.valueOf(enabled && counts != null ? Math.max(0, counts.optInt(key, 0)) : 0);
    }
    private static PendingIntent deepLink(Context context, String uri, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), context, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static JSONObject readSnapshot(Context context) {
        String raw = context.getSharedPreferences(EngXWidgetsPlugin.PREFS_NAME, Context.MODE_PRIVATE).getString(EngXWidgetsPlugin.SNAPSHOT_KEY, "{}");
        try { return new JSONObject(raw == null ? "{}" : raw); } catch (Exception ignored) { return new JSONObject(); }
    }
}
