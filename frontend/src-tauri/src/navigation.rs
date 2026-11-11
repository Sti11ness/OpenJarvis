use tauri::{plugin, Manager, Runtime, Url};
use tauri_plugin_shell::ShellExt;

fn has_no_credentials(url: &Url) -> bool {
    url.username().is_empty() && url.password().is_none()
}

fn is_app_navigation(url: &Url, dev_url: Option<&Url>) -> bool {
    if !has_no_credentials(url) {
        return false;
    }
    let is_tauri_origin = url.port().is_none()
        && matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        );
    is_tauri_origin || dev_url.is_some_and(|dev_url| url.origin() == dev_url.origin())
}

fn is_browser_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.has_host() && has_no_credentials(url)
}

#[allow(deprecated)]
fn open_in_browser<R: Runtime>(app: &tauri::AppHandle<R>, url: &Url) -> Result<(), String> {
    if !is_browser_url(url) {
        return Err("Only HTTP and HTTPS links can be opened in the browser.".into());
    }
    app.shell()
        .open(url.as_str(), None)
        .map_err(|_| "Could not open the link in the default browser.".into())
}

#[tauri::command]
pub fn open_external_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|_| "Invalid browser link.".to_string())?;
    open_in_browser(&app, &url)
}

pub fn guard<R: Runtime>() -> plugin::TauriPlugin<R> {
    plugin::Builder::new("main-navigation")
        .on_navigation(|webview, url| {
            // Connector OAuth can open its own window. This rule is for the chat window.
            if webview.label() != "main" {
                return true;
            }
            let app = webview.app_handle();
            let dev_url = if tauri::is_dev() {
                app.config().build.dev_url.as_ref()
            } else {
                None
            };
            if is_app_navigation(url, dev_url) {
                return true;
            }
            let _ = open_in_browser(app, url);
            false
        })
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && is_app_navigation(payload.url(), None)
            {
                let _ = webview.eval(include_str!("desktop-service-worker-migration.js"));
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_navigation_accepts_the_app_and_exact_dev_origins() {
        let dev = Url::parse("http://localhost:5173").unwrap();
        for url in [
            "tauri://localhost/settings#models",
            "http://tauri.localhost/",
            "https://tauri.localhost/settings",
            "http://localhost:5173/settings",
        ] {
            assert!(is_app_navigation(&Url::parse(url).unwrap(), Some(&dev)));
        }
        for url in [
            "https://example.test/source",
            "https://tauri.localhost.example.test/",
            "http://tauri.localhost:5173/",
            "http://localhost:8148/settings",
            "tauri://example.test/",
        ] {
            assert!(!is_app_navigation(&Url::parse(url).unwrap(), Some(&dev)));
        }
        assert!(!is_app_navigation(&dev, None));
    }

    #[test]
    fn the_browser_only_receives_http_links_without_credentials() {
        for url in ["https://example.test/source", "http://127.0.0.1:8148/"] {
            assert!(is_browser_url(&Url::parse(url).unwrap()));
        }
        for url in [
            "file:///C:/Users/file.txt",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "https://user:password@example.test/",
        ] {
            assert!(!is_browser_url(&Url::parse(url).unwrap()));
        }
    }
}
