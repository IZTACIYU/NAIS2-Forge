//! Keep the auto-hide taskbar below the active main window when it fills its monitor.
use std::sync::OnceLock;
use windows::{
    core::{w, Error, Result},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, RPC_E_WRONG_THREAD, WPARAM},
        Graphics::Gdi::{
            ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO,
            MONITOR_DEFAULTTONEAREST,
        },
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
                COINIT_APARTMENTTHREADED,
            },
            Threading::GetCurrentThreadId,
        },
        UI::{
            Shell::{
                DefSubclassProc, ITaskbarList2, RemoveWindowSubclass, SetWindowSubclass,
                TaskbarList,
            },
            WindowsAndMessaging::*,
        },
    },
};

const SUBCLASS_ID: usize = 0x4e414953;
static TASKBAR_MESSAGES: OnceLock<[u32; 2]> = OnceLock::new();

fn covers_monitor(client: RECT, monitor: RECT, maximized: bool) -> bool {
    // Allow the observed maximized auto-hide reveal strip, in physical pixels only.
    let tolerance = if maximized { 2 } else { 0 };
    client.right > client.left
        && client.bottom > client.top
        && client.left <= monitor.left + tolerance
        && client.top <= monitor.top + tolerance
        && client.right >= monitor.right - tolerance
        && client.bottom >= monitor.bottom - tolerance
}

unsafe fn eligible(hwnd: HWND) -> bool {
    if GetForegroundWindow() != hwnd || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool()
    {
        return false;
    }
    let mut client = RECT::default();
    let mut origin = POINT::default();
    let mut monitor = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetClientRect(hwnd, &mut client).is_err()
        || !ClientToScreen(hwnd, &mut origin).as_bool()
        || !GetMonitorInfoW(
            MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .as_bool()
    {
        return false;
    }
    client.left += origin.x;
    client.right += origin.x;
    client.top += origin.y;
    client.bottom += origin.y;
    covers_monitor(client, monitor.rcMonitor, IsZoomed(hwnd).as_bool())
}

struct ComApartment;

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

unsafe fn mark(hwnd: HWND, fullscreen: bool) -> Result<()> {
    // All calls stay on the HWND's thread. Balance even S_FALSE; release COM before uninitializing.
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    let _apartment = ComApartment;
    let taskbar: ITaskbarList2 = CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)?;
    taskbar.HrInit()?;
    taskbar.MarkFullscreenWindow(hwnd, fullscreen)
}

unsafe fn update(hwnd: HWND, fullscreen: bool) {
    if let Err(error) = mark(hwnd, fullscreen) {
        log::warn!("Could not update taskbar fullscreen marking: {error}");
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    refresh_message: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        update(hwnd, false);
        let _ = RemoveWindowSubclass(hwnd, Some(window_proc), subclass_id);
        return DefSubclassProc(hwnd, message, wparam, lparam);
    }
    if message == refresh_message as u32 {
        update(hwnd, eligible(hwnd));
        return LRESULT(0);
    }
    if message == WM_ACTIVATE && wparam.0 & 0xffff == WA_INACTIVE as usize {
        update(hwnd, false);
    }
    let result = DefSubclassProc(hwnd, message, wparam, lparam);
    if matches!(
        message,
        WM_ACTIVATE
            | WM_SIZE
            | WM_WINDOWPOSCHANGED
            | WM_SHOWWINDOW
            | WM_DPICHANGED
            | WM_DISPLAYCHANGE
            | WM_SETTINGCHANGE
    ) || TASKBAR_MESSAGES
        .get()
        .is_some_and(|messages| messages.contains(&message))
    {
        // Read final geometry/focus after Windows and Tauri finish processing the transition.
        if let Err(error) = PostMessageW(Some(hwnd), refresh_message as u32, WPARAM(0), LPARAM(0)) {
            log::warn!("Could not schedule taskbar fullscreen update: {error}");
        }
    }
    result
}

/// Called once from Tauri setup on the main window's owning thread.
pub fn install(hwnd: HWND) -> Result<()> {
    unsafe {
        if GetWindowThreadProcessId(hwnd, None) != GetCurrentThreadId() {
            return Err(Error::from_hresult(RPC_E_WRONG_THREAD));
        }
        let refresh = RegisterWindowMessageW(w!("NAIS2Forge.TaskbarFullscreen.Refresh"));
        let taskbar_messages = TASKBAR_MESSAGES.get_or_init(|| {
            [
                RegisterWindowMessageW(w!("TaskbarCreated")),
                RegisterWindowMessageW(w!("TaskbarButtonCreated")),
            ]
        });
        if refresh == 0
            || taskbar_messages.contains(&0)
            || !SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, refresh as usize).as_bool()
        {
            return Err(Error::from_win32());
        }
        update(hwnd, eligible(hwnd));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn only_monitor_filling_geometry_is_eligible() {
        let monitor = rect(0, 0, 1920, 1080);
        assert!(covers_monitor(monitor, monitor, false));
        assert!(covers_monitor(rect(0, 0, 1920, 1079), monitor, true));
        assert!(!covers_monitor(rect(0, 0, 1920, 1079), monitor, false));
        assert!(!covers_monitor(rect(0, 0, 960, 1080), monitor, true));
        assert!(!covers_monitor(rect(0, 0, 1920, 1040), monitor, true));
        assert!(!covers_monitor(rect(200, 100, 1500, 900), monitor, false));
        assert!(!covers_monitor(RECT::default(), monitor, true));
        assert!(covers_monitor(
            rect(-1920, -1080, 0, -1),
            rect(-1920, -1080, 0, 0),
            true
        ));
        assert!(!covers_monitor(rect(0, 0, 1920, 1077), monitor, true));
        assert!(covers_monitor(rect(1, 1, 1919, 1079), monitor, true));
        assert!(!covers_monitor(rect(1, 1, 1919, 1079), monitor, false));
    }

    #[test]
    fn maximized_tolerance_stays_in_physical_pixels_at_high_dpi() {
        let monitor = rect(1920, -1620, 4800, 0);
        assert!(covers_monitor(rect(1920, -1620, 4800, -1), monitor, true));
        assert!(!covers_monitor(rect(1920, -1620, 4800, -3), monitor, true));
        assert!(!covers_monitor(rect(1920, -1620, 4800, -1), monitor, false));
    }
}
