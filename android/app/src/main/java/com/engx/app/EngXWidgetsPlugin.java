package com.engx.app;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native bridge for the cached, user-opted-in home-screen widget snapshot. */
@CapacitorPlugin(name = "EngXWidgets")
public class EngXWidgetsPlugin extends Plugin {
    public static final String PREFS_NAME = "engx-widget";
    public static final String SNAPSHOT_KEY = "snapshot";

    @PluginMethod
    public void update(PluginCall call) {
        try {
            JSObject data = call.getData();
            JSONObject snapshot = new JSONObject();
            boolean enabled = data != null && data.optBoolean("enabled", false);
            snapshot.put("enabled", enabled);
            snapshot.put("domain", truncate(data == null ? "medical" : data.optString("domain", "medical"), 80));

            JSONObject counts = new JSONObject();
            JSObject suppliedCounts = data == null ? null : data.getJSObject("counts");
            String[] keys = {"openOrders", "pmDue", "calDue", "lowStock", "pendingApprovals"};
            for (String key : keys) counts.put(key, Math.max(0, suppliedCounts == null ? 0 : suppliedCounts.optInt(key, 0)));
            snapshot.put("counts", counts);

            JSONArray items = new JSONArray();
            JSONArray suppliedItems = data == null ? null : data.optJSONArray("items");
            if (suppliedItems != null) {
                for (int i = 0; i < suppliedItems.length() && items.length() < 3; i++) {
                    JSONObject item = suppliedItems.optJSONObject(i);
                    if (item == null) continue;
                    JSONObject safe = new JSONObject();
                    safe.put("id", truncate(item.optString("id", ""), 80));
                    safe.put("kind", truncate(item.optString("kind", ""), 20));
                    safe.put("label", truncate(item.optString("label", ""), 80));
                    safe.put("date", truncate(item.optString("date", ""), 40));
                    safe.put("uri", truncate(item.optString("uri", ""), 240));
                    items.put(safe);
                }
            }
            snapshot.put("items", items);
            snapshot.put("updatedAt", truncate(data == null ? "" : data.optString("updatedAt", ""), 40));

            Context context = getContext();
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(SNAPSHOT_KEY, snapshot.toString()).apply();
            EngXWidgetProvider.updateAll(context);
            call.resolve();
        } catch (Exception error) {
            call.reject("تعذر تحديث ودجت EngX", error);
        }
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) return "";
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
