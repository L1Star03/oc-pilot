package com.ocpilot.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

public class MainActivity extends Activity {

    static final String DEFAULT_URL = "";
    static final int FILE_CHOOSER_CODE = 555;

    WebView web;
    SharedPreferences prefs;
    String url;
    boolean errShown = false;
    ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("cfg", MODE_PRIVATE);
        url = prefs.getString("url", DEFAULT_URL);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#10141d"));
        w.setNavigationBarColor(Color.parseColor("#10141d"));

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.setBackgroundColor(Color.parseColor("#0b0e14"));

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (scheme.equals("http") || scheme.equals("https")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError();
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                errShown = false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    startActivityForResult(Intent.createChooser(i, "选择文件"), FILE_CHOOSER_CODE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView v, String t, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(t == null ? "提示" : t)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String t, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(t == null ? "确认" : t)
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });

        web.setDownloadListener((dlUrl, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(dlUrl));
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = dlUrl.substring(dlUrl.lastIndexOf('/') + 1);
                int q = name.indexOf('?');
                if (q > 0) name = name.substring(0, q);
                try { name = java.net.URLDecoder.decode(name, "UTF-8"); } catch (Exception ignored) {}
                if (name.isEmpty()) name = "download";
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                if (mimetype != null && !mimetype.isEmpty()) req.setMimeType(mimetype);
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                dm.enqueue(req);
                toast("已开始下载: " + name);
            } catch (Exception e) {
                toast("下载失败: " + e.getMessage());
            }
        });

        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                showUrlDialog();
                return true;
            }
        });

        if (url == null || url.trim().isEmpty()) { showUrlDialog(); } else { web.loadUrl(url); }
    }

    void toast(String t) {
        Toast.makeText(this, t, Toast.LENGTH_SHORT).show();
    }

    void showError() {
        if (errShown) return;
        errShown = true;
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{background:#0b0e14;color:#d7dce5;font-family:sans-serif;display:flex;"
                + "flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}"
                + "h2{font-weight:400}button{background:#4f8cff;color:#fff;border:none;border-radius:10px;"
                + "padding:12px 34px;font-size:16px;margin-top:18px}</style></head><body>"
                + "<h2>无法连接服务器</h2>"
                + "<div style='color:#6b7488;font-size:13px;text-align:center'>检查电脑端服务与 Tailscale VPN<br>长按屏幕可修改服务器地址</div>"
                + "<button onclick=\"location.href='" + url + "'\">重试</button></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    void showUrlDialog() {
        final EditText input = new EditText(this);
        input.setText(url);
        input.setTextColor(Color.parseColor("#d7dce5"));
        new AlertDialog.Builder(this)
                .setTitle("服务器地址")
                .setView(input)
                .setPositiveButton("保存", (d, w) -> {
                    String u = input.getText().toString().trim();
                    if (!u.isEmpty()) {
                        if (!u.startsWith("http")) u = "http://" + u;
                        url = u;
                        prefs.edit().putString("url", url).apply();
                        errShown = false;
                        web.loadUrl(url);
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web.canGoBack()) {
                web.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
}
