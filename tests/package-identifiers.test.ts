import { expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
const read = (name:string) => readFileSync(new URL("../"+name, import.meta.url), "utf8");
it("uses EngX and com.engx.app on both native platforms", () => {
 expect(read("capacitor.config.ts")).toContain("appId:'com.engx.app'");
 expect(read("capacitor.config.ts")).toContain("appName:'EngX'");
 expect(read("android/app/build.gradle")).toContain('applicationId "com.engx.app"');
 expect(read("android/app/build.gradle")).toContain('namespace "com.engx.app"');
 expect(read("android/app/src/main/java/com/engx/app/MainActivity.java")).toContain("package com.engx.app;");
 const ios = read("ios/App/App.xcodeproj/project.pbxproj");
 expect(ios).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.engx.app;");
 expect(ios).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.engx.app.EngXWidget;");
 expect(read("ios/App/App/App.entitlements")).toContain("group.com.engx.app");
});
it("declares widget action links and uses compatible RemoteViews layout classes", () => {
 const manifest=read("android/app/src/main/AndroidManifest.xml");
 for(const host of ["order","screen","notifications","new-order","scan","device"]) expect(manifest).toContain(`android:host="${host}"`);
 const layout=read("android/app/src/main/res/layout/widget_engx.xml");
 expect(layout).not.toContain("<Space");
 for(const id of ["widget_notifications","widget_scan","widget_new_order","widget_item_1"]) expect(layout).toContain(`@+id/${id}`);
 expect(existsSync(new URL("../android/gradle/wrapper/gradle-wrapper.jar",import.meta.url))).toBe(true);
});
