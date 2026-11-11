// Modified in the Codex onboarding fork to keep Windows launches windowed.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    openjarvis_desktop::run();
}
