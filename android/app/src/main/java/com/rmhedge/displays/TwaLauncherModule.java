package com.rmhedge.displays;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.util.Collections;

public final class TwaLauncherModule
    extends ReactContextBaseJavaModule {

    private static final String TAG =
        "RMHEDGE_TWA";

    private static final String BROWSER_PACKAGE =
        "org.chromium.thorium";

    private CustomTabsServiceConnection connection;
    private CustomTabsSession session;
    private Context boundContext;
    private Promise pendingPromise;
    private boolean promiseCompleted;

    public TwaLauncherModule(
        ReactApplicationContext reactContext
    ) {
        super(reactContext);
    }

    @NonNull
    @Override
    public String getName() {
        return "TwaLauncher";
    }

    @ReactMethod
    public void launch(
        String url,
        Promise promise
    ) {
        Activity activity =
            getCurrentActivity();

        if (activity == null) {
            promise.reject(
                "NO_ACTIVITY",
                "No foreground Android activity is available"
            );

            return;
        }

        Uri uri =
            Uri.parse(url.trim());

        String scheme =
            uri.getScheme();

        String host =
            uri.getHost();

        if (
            !"https".equals(scheme) ||
            host == null ||
            host.isEmpty()
        ) {
            promise.reject(
                "INVALID_URL",
                "A valid HTTPS display URL is required"
            );

            return;
        }

        disconnect();

        pendingPromise = promise;
        promiseCompleted = false;

        Log.i(
            TAG,
            "Requested URL: " + uri
        );

        Log.i(
            TAG,
            "Required browser package: " +
                BROWSER_PACKAGE
        );

        String detectedPackage =
            CustomTabsClient.getPackageName(
                activity,
                Collections.singletonList(
                    BROWSER_PACKAGE
                ),
                false
            );

        Log.i(
            TAG,
            "Detected browser package: " +
                detectedPackage
        );

        if (
            !BROWSER_PACKAGE.equals(
                detectedPackage
            )
        ) {
            rejectPromise(
                "THORIUM_UNAVAILABLE",
                "Thorium is not available as a " +
                    "Custom Tabs provider",
                null
            );

            return;
        }

        CustomTabsServiceConnection newConnection =
            new CustomTabsServiceConnection() {

                @Override
                public void onCustomTabsServiceConnected(
                    @NonNull ComponentName componentName,
                    @NonNull CustomTabsClient client
                ) {
                    Log.i(
                        TAG,
                        "Connected to browser service: " +
                            componentName
                                .flattenToShortString()
                    );

                    boolean warmed =
                        client.warmup(0L);

                    Log.i(
                        TAG,
                        "Browser warmup result: " +
                            warmed
                    );

                    CustomTabsSession newSession =
                        client.newSession(null);

                    if (newSession == null) {
                        rejectPromise(
                            "NO_SESSION",
                            "Thorium did not create a " +
                                "Custom Tabs session",
                            null
                        );

                        return;
                    }

                    session = newSession;

                    TrustedWebActivityIntent twaIntent =
                        new TrustedWebActivityIntentBuilder(
                            uri
                        ).build(newSession);

                    twaIntent
                        .getIntent()
                        .setPackage(
                            BROWSER_PACKAGE
                        );

                    boolean trusted =
                        twaIntent
                            .getIntent()
                            .getBooleanExtra(
                                "android.support.customtabs.extra." +
                                    "LAUNCH_AS_TRUSTED_WEB_ACTIVITY",
                                false
                            );

                    Log.i(
                        TAG,
                        "Trusted launch extra: " +
                            trusted
                    );

                    Log.i(
                        TAG,
                        "Launching with package: " +
                            twaIntent
                                .getIntent()
                                .getPackage()
                    );

                    try {
                        twaIntent
                            .launchTrustedWebActivity(
                                activity
                            );

                        Log.i(
                            TAG,
                            "Thorium TWA launch completed"
                        );

                        resolvePromise();
                    } catch (Exception error) {
                        Log.e(
                            TAG,
                            "Thorium TWA launch failed",
                            error
                        );

                        rejectPromise(
                            "TWA_LAUNCH_FAILED",
                            "Thorium TWA launch failed",
                            error
                        );
                    }
                }

                @Override
                public void onServiceDisconnected(
                    @NonNull ComponentName componentName
                ) {
                    Log.w(
                        TAG,
                        "Browser service disconnected: " +
                            componentName
                                .flattenToShortString()
                    );

                    session = null;
                }
            };

        connection = newConnection;
        boundContext = activity;

        boolean started =
            CustomTabsClient
                .bindCustomTabsService(
                    activity,
                    BROWSER_PACKAGE,
                    newConnection
                );

        Log.i(
            TAG,
            "Browser binding requested: " +
                started
        );

        if (!started) {
            rejectPromise(
                "BIND_FAILED",
                "Could not bind to Thorium",
                null
            );

            disconnect();
        }
    }

    private void resolvePromise() {
        if (
            promiseCompleted ||
            pendingPromise == null
        ) {
            return;
        }

        promiseCompleted = true;

        pendingPromise.resolve(null);
        pendingPromise = null;
    }

    private void rejectPromise(
        String code,
        String message,
        Exception error
    ) {
        if (
            promiseCompleted ||
            pendingPromise == null
        ) {
            return;
        }

        promiseCompleted = true;

        if (error == null) {
            pendingPromise.reject(
                code,
                message
            );
        } else {
            pendingPromise.reject(
                code,
                message,
                error
            );
        }

        pendingPromise = null;
    }

    private void disconnect() {
        Context context =
            boundContext;

        CustomTabsServiceConnection oldConnection =
            connection;

        boundContext = null;
        connection = null;
        session = null;

        if (
            context == null ||
            oldConnection == null
        ) {
            return;
        }

        try {
            context.unbindService(
                oldConnection
            );
        } catch (Exception ignored) {
            // The service may already be disconnected.
        }
    }

    @Override
    public void invalidate() {
        disconnect();

        pendingPromise = null;
        promiseCompleted = false;

        super.invalidate();
    }
}
