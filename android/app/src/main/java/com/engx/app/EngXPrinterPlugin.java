package com.engx.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "EngXPrinter")
public class EngXPrinterPlugin extends Plugin {
    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) { call.reject("خدمة الطباعة غير متاحة على الهاتف"); return; }
                PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter("EngX Maintenance Report");
                manager.print("EngX Maintenance Report", adapter,
                    new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR).build());
                call.resolve();
            } catch (Exception error) {
                call.reject("تعذر فتح نافذة الطباعة", error);
            }
        });
    }
}
