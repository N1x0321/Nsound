using System.Runtime.InteropServices;

namespace LibreStream.App;

/// <summary>
/// Icono de Nsound junto al reloj (Windows suele guardarlo en «iconos ocultos», la flecha ^). Un clic abre la ventana;
/// el botón derecho muestra un menú con la reproducción y «Salir». Se usa Shell_NotifyIcon directamente, sin dependencias.
/// </summary>
internal sealed class TrayIcon : IDisposable
{
    private const int CmdOpen = 1, CmdPlay = 2, CmdPrev = 3, CmdNext = 4, CmdExit = 5;
    private const uint IconId = 1, CallbackMessage = 0x8000 + 1 /* WM_APP + 1 */;
    private const uint NimAdd = 0, NimModify = 1, NimDelete = 2, NimSetVersion = 4;

    private readonly IntPtr _hwnd;
    private readonly string _iconFile;
    private readonly Action<int> _command;
    private readonly Action _sessionEnding;
    private readonly SubclassProc _proc;
    private readonly uint _taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    private IntPtr _icon;
    private bool _wanted, _shown, _playing, _hasItem;
    private string _tip = "Nsound";

    public TrayIcon(IntPtr hwnd, string iconFile, Action open, Action playPause, Action previous, Action next, Action exit, Action sessionEnding)
    {
        _hwnd = hwnd; _iconFile = iconFile; _sessionEnding = sessionEnding;
        _command = id => (id switch { CmdOpen => open, CmdPlay => playPause, CmdPrev => previous, CmdNext => next, CmdExit => exit, _ => null })?.Invoke();
        _proc = WndProc;
        SetWindowSubclass(_hwnd, _proc, 2, UIntPtr.Zero);
    }

    /// <summary>true si el icono está de verdad en la barra: solo entonces se puede esconder la ventana sin perderla.</summary>
    public bool Shown => _shown;

    public void Show()
    {
        _wanted = true;
        if (_shown) return;
        if (_icon == IntPtr.Zero)
        {
            var size = (int)Math.Max(16, Math.Round(16 * GetDpiForWindow(_hwnd) / 96.0));
            _icon = LoadImage(IntPtr.Zero, _iconFile, 1 /* IMAGE_ICON */, size, size, 0x10 /* LR_LOADFROMFILE */);
        }
        var data = Data();
        if (!Shell_NotifyIcon(NimAdd, ref data)) return;
        data.uVersion = 4;   // NOTIFYICON_VERSION_4: clics y teclado como en las apps actuales
        Shell_NotifyIcon(NimSetVersion, ref data);
        _shown = true;
    }

    public void Hide()
    {
        _wanted = false;
        Remove();
    }

    /// <summary>Texto al pasar el ratón y estado del menú.</summary>
    public void Update(bool playing, bool hasItem, string? title)
    {
        _playing = playing; _hasItem = hasItem;
        var tip = string.IsNullOrWhiteSpace(title) ? "Nsound" : "Nsound · " + title;
        if (tip.Length > 127) tip = tip[..126] + "…";
        if (tip == _tip) return;
        _tip = tip;
        if (!_shown) return;
        var data = Data();
        Shell_NotifyIcon(NimModify, ref data);
    }

    private void Remove()
    {
        if (!_shown) return;
        var data = Data();
        Shell_NotifyIcon(NimDelete, ref data);
        _shown = false;
    }

    private NotifyIconData Data() => new()
    {
        cbSize = (uint)Marshal.SizeOf<NotifyIconData>(),
        hWnd = _hwnd,
        uID = IconId,
        uFlags = 0x01 /* MESSAGE */ | 0x02 /* ICON */ | 0x04 /* TIP */ | 0x80 /* SHOWTIP */,
        uCallbackMessage = CallbackMessage,
        hIcon = _icon,
        szTip = _tip,
        szInfo = "",
        szInfoTitle = "",
    };

    private IntPtr WndProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
    {
        try
        {
            if (msg == CallbackMessage)
            {
                var what = (uint)(lParam.ToInt64() & 0xFFFF);
                if (what is 0x400 /* NIN_SELECT: clic */ or 0x401 /* NIN_KEYSELECT: teclado */) _command(CmdOpen);
                else if (what == 0x007B /* WM_CONTEXTMENU */)
                {
                    var at = (long)wParam.ToUInt64();
                    ShowMenu((short)(at & 0xFFFF), (short)((at >> 16) & 0xFFFF));
                }
                return IntPtr.Zero;
            }
            if (msg == _taskbarCreated && _wanted)   // el Explorador se ha reiniciado y ha perdido los iconos
            {
                _shown = false;
                Show();
            }
            else if (msg == 0x0011 /* WM_QUERYENDSESSION */) _sessionEnding();   // apagado, o el instalador pidiendo que se cierre
        }
        catch (Exception ex) { App.Log("Icono junto al reloj", ex); }
        return DefSubclassProc(hWnd, msg, wParam, lParam);
    }

    private void ShowMenu(int x, int y)
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;
        try
        {
            const uint Normal = 0, Disabled = 0x0001, Separator = 0x0800;
            AppendMenu(menu, Normal, CmdOpen, "Abrir Nsound");
            AppendMenu(menu, Separator, 0, null);
            AppendMenu(menu, Normal, CmdPlay, _playing ? "Pausa" : "Reproducir");
            AppendMenu(menu, _hasItem ? Normal : Disabled, CmdPrev, "Anterior");
            AppendMenu(menu, _hasItem ? Normal : Disabled, CmdNext, "Siguiente");
            AppendMenu(menu, Separator, 0, null);
            AppendMenu(menu, Normal, CmdExit, "Salir de Nsound");
            SetMenuDefaultItem(menu, CmdOpen, 0);
            SetForegroundWindow(_hwnd);   // sin esto el menú no se cierra al pulsar fuera
            var chosen = TrackPopupMenuEx(menu, 0x0100 /* RETURNCMD */ | 0x0002 /* RIGHTBUTTON */ | 0x0080 /* NONOTIFY */, x, y, _hwnd, IntPtr.Zero);
            PostMessage(_hwnd, 0 /* WM_NULL */, IntPtr.Zero, IntPtr.Zero);
            if (chosen != 0) _command(chosen);
        }
        finally { DestroyMenu(menu); }
    }

    public void Dispose()
    {
        Hide();
        try { RemoveWindowSubclass(_hwnd, _proc, 2); } catch { /* ya quitada */ }
        if (_icon != IntPtr.Zero) { DestroyIcon(_icon); _icon = IntPtr.Zero; }
    }

    // ===================== Interop =====================

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);

    // NOTIFYICONDATAW. En 32 bits Windows la declara empaquetada a 1 byte, pero todos sus campos caen alineados igual.
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID, uFlags, uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState, dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", EntryPoint = "Shell_NotifyIconW", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIcon(uint message, ref NotifyIconData data);
    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc proc, UIntPtr id, UIntPtr data);
    [DllImport("comctl32.dll")] private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc proc, UIntPtr id);
    [DllImport("comctl32.dll")] private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll", EntryPoint = "AppendMenuW", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(IntPtr menu, uint flags, nint id, string? text);
    [DllImport("user32.dll")] private static extern bool SetMenuDefaultItem(IntPtr menu, uint item, uint byPosition);
    [DllImport("user32.dll")] private static extern int TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hWnd, IntPtr parameters);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll", EntryPoint = "PostMessageW")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
