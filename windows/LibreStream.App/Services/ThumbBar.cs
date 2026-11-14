using System.Runtime.InteropServices;

namespace LibreStream.App;

/// <summary>
/// Mini reproductor de la barra de tareas de Windows: al pasar el ratón por el icono de Nsound, bajo la vista previa de la
/// ventana aparecen los botones Anterior, Reproducir/Pausa, Siguiente y Guardar (ITaskbarList3, igual que Spotify).
/// Los iconos se dibujan en memoria (sin archivos). Cualquier fallo se ignora: la app funciona igual sin estos botones.
/// </summary>
internal sealed class ThumbBar : IDisposable
{
    private const int IdPrev = 100, IdPlay = 101, IdNext = 102, IdSave = 103;

    private readonly IntPtr _hwnd;
    private readonly Action _onPrev, _onPlay, _onNext, _onSave;
    private readonly SubclassProc _proc;
    private readonly uint _taskbarCreatedMsg = RegisterWindowMessage("TaskbarButtonCreated");
    private ITaskbarList3? _taskbar;
    private bool _added;
    private IntPtr _iPrev, _iNext, _iPlay, _iPause, _iAdd, _iCheck;

    private bool _playing, _hasItem, _saved;

    public ThumbBar(IntPtr hwnd, Action onPrev, Action onPlay, Action onNext, Action onSave)
    {
        _hwnd = hwnd; _onPrev = onPrev; _onPlay = onPlay; _onNext = onNext; _onSave = onSave;
        _proc = WndProc;
        try
        {
            SetWindowSubclass(_hwnd, _proc, UIntPtr.Zero, UIntPtr.Zero);
            ChangeWindowMessageFilterEx(_hwnd, _taskbarCreatedMsg, 1 /* MSGFLT_ALLOW */, IntPtr.Zero);
            TryAdd();   // la ventana ya suele tener su botón en la barra; si no, se añade al llegar TaskbarButtonCreated
        }
        catch (Exception ex) { App.Log("Barra de tareas: inicio", ex); }
    }

    /// <summary>Actualiza iconos y textos: reproduciendo o en pausa, si hay algo cargado y si está guardado.</summary>
    public void Update(bool playing, bool hasItem, bool saved)
    {
        _playing = playing; _hasItem = hasItem; _saved = saved;
        if (!_added || _taskbar is null) return;
        try { _taskbar.ThumbBarUpdateButtons(_hwnd, 4, Build()); }
        catch (Exception ex) { App.Log("Barra de tareas: actualizar", ex); }
    }

    private void TryAdd()
    {
        try
        {
            EnsureIcons();
            _taskbar ??= (ITaskbarList3)new CTaskbarList();
            _taskbar.HrInit();
            _taskbar.ThumbBarAddButtons(_hwnd, 4, Build());
            _added = true;
        }
        catch (Exception ex)
        {
            _added = false;
            App.Log("Barra de tareas: añadir botones", ex);
        }
    }

    private ThumbButton[] Build() =>
    [
        Button(IdPrev, _iPrev, "Anterior", _hasItem),
        Button(IdPlay, _playing ? _iPause : _iPlay, _playing ? "Pausa" : "Reproducir", true),
        Button(IdNext, _iNext, "Siguiente", _hasItem),
        Button(IdSave, _saved ? _iCheck : _iAdd, _saved ? "Quitar de la biblioteca" : "Guardar en la biblioteca", _hasItem),
    ];

    private static ThumbButton Button(int id, IntPtr icon, string tip, bool enabled) => new()
    {
        dwMask = ThbMask.Icon | ThbMask.Tooltip | ThbMask.Flags,
        iId = (uint)id,
        hIcon = icon,
        szTip = tip,
        dwFlags = enabled ? 0u : 1u,   // THBF_ENABLED / THBF_DISABLED
    };

    private IntPtr WndProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data)
    {
        try
        {
            if (msg == _taskbarCreatedMsg)
            {
                _added = false;
                TryAdd();
                Update(_playing, _hasItem, _saved);
            }
            else if (msg == 0x0111 /* WM_COMMAND */ && ((uint)wParam >> 16) == 0x1800 /* THBN_CLICKED */)
            {
                switch ((int)((uint)wParam & 0xFFFF))
                {
                    case IdPrev: _onPrev(); return IntPtr.Zero;
                    case IdPlay: _onPlay(); return IntPtr.Zero;
                    case IdNext: _onNext(); return IntPtr.Zero;
                    case IdSave: _onSave(); return IntPtr.Zero;
                }
            }
        }
        catch (Exception ex) { App.Log("Barra de tareas: mensaje", ex); }
        return DefSubclassProc(hWnd, msg, wParam, lParam);
    }

    // ===================== Iconos dibujados en memoria =====================

    private void EnsureIcons()
    {
        if (_iPrev != IntPtr.Zero) return;
        int dpi = 96;
        try { dpi = (int)GetDpiForWindow(_hwnd); } catch { /* Windows antiguo: 96 */ }
        int size = Math.Max(16, (int)Math.Round(16 * dpi / 96.0));
        _iPrev = MakeIcon(size, Prev);
        _iNext = MakeIcon(size, Next);
        _iPlay = MakeIcon(size, Play);
        _iPause = MakeIcon(size, Pause);
        _iAdd = MakeIcon(size, Plus);
        _iCheck = MakeIcon(size, Check);
    }

    // Formas en coordenadas 0..1
    private static bool InTri(double x, double y, double ax, double ay, double bx, double by, double cx, double cy)
    {
        double d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
        double d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
        double d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
        bool neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(neg && pos);
    }
    private static bool InRect(double x, double y, double x0, double y0, double x1, double y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    private static bool Prev(double x, double y) => InRect(x, y, 0.20, 0.22, 0.30, 0.78) || InTri(x, y, 0.80, 0.22, 0.80, 0.78, 0.34, 0.50);
    private static bool Next(double x, double y) => Prev(1 - x, y);
    private static bool Play(double x, double y) => InTri(x, y, 0.28, 0.16, 0.28, 0.84, 0.84, 0.50);
    private static bool Pause(double x, double y) => InRect(x, y, 0.24, 0.18, 0.42, 0.82) || InRect(x, y, 0.58, 0.18, 0.76, 0.82);
    private static bool Plus(double x, double y) => InRect(x, y, 0.43, 0.20, 0.57, 0.80) || InRect(x, y, 0.20, 0.43, 0.80, 0.57);
    private static bool Check(double x, double y) => NearSegment(x, y, 0.20, 0.54, 0.42, 0.76, 0.075) || NearSegment(x, y, 0.42, 0.76, 0.82, 0.28, 0.075);

    private static bool NearSegment(double x, double y, double ax, double ay, double bx, double by, double r)
    {
        double dx = bx - ax, dy = by - ay;
        double t = Math.Clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        double px = ax + t * dx - x, py = ay + t * dy - y;
        return px * px + py * py <= r * r;
    }

    /// <summary>Dibuja la forma en blanco con un borde oscuro suave (se lee sobre fondos claros y oscuros).</summary>
    private static IntPtr MakeIcon(int size, Func<double, double, bool> shape)
    {
        const int S = 4;                       // supermuestreo S×S
        double px = 1.0 / size;
        var pixels = new byte[size * size * 4];
        for (int j = 0; j < size; j++)
            for (int i = 0; i < size; i++)
            {
                int inside = 0, ring = 0;
                for (int sj = 0; sj < S; sj++)
                    for (int si = 0; si < S; si++)
                    {
                        double x = (i + (si + 0.5) / S) * px, y = (j + (sj + 0.5) / S) * px;
                        if (shape(x, y)) inside++;
                        else if (shape(x - px, y) || shape(x + px, y) || shape(x, y - px) || shape(x, y + px)) ring++;
                    }
                double w = inside / (double)(S * S), d = Math.Min(ring / (double)(S * S), 1 - w) * 0.55;
                // BGRA premultiplicado: blanco con peso w sobre un borde negro de alfa d
                double a = w + d * (1 - w);
                double c = w;                  // color premultiplicado (blanco*w + negro*d)
                int o = (j * size + i) * 4;
                byte cb = (byte)Math.Round(c * 255), ab = (byte)Math.Round(a * 255);
                pixels[o] = cb; pixels[o + 1] = cb; pixels[o + 2] = cb; pixels[o + 3] = ab;
            }

        var bmi = new BitmapInfo { biSize = 40, biWidth = size, biHeight = -size, biPlanes = 1, biBitCount = 32 };
        IntPtr color = CreateDIBSection(IntPtr.Zero, ref bmi, 0, out IntPtr bits, IntPtr.Zero, 0);
        if (color == IntPtr.Zero) return IntPtr.Zero;
        Marshal.Copy(pixels, 0, bits, pixels.Length);
        IntPtr mask = CreateBitmap(size, size, 1, 1, IntPtr.Zero);
        var info = new IconInfo { fIcon = true, hbmMask = mask, hbmColor = color };
        IntPtr icon = CreateIconIndirect(ref info);
        DeleteObject(color); DeleteObject(mask);
        return icon;
    }

    public void Dispose()
    {
        try { RemoveWindowSubclass(_hwnd, _proc, UIntPtr.Zero); } catch { /* ya quitada */ }
        foreach (var h in new[] { _iPrev, _iNext, _iPlay, _iPause, _iAdd, _iCheck }) if (h != IntPtr.Zero) DestroyIcon(h);
    }

    // ===================== Interop =====================

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, UIntPtr id, UIntPtr data);

    [Flags] private enum ThbMask : uint { Bitmap = 1, Icon = 2, Tooltip = 4, Flags = 8 }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ThumbButton
    {
        public ThbMask dwMask;
        public uint iId;
        public uint iBitmap;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szTip;
        public uint dwFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfo
    {
        public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount;
        public uint biCompression, biSizeImage; public int biXPelsPerMeter, biYPelsPerMeter; public uint biClrUsed, biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IconInfo { public bool fIcon; public uint xHotspot, yHotspot; public IntPtr hbmMask, hbmColor; }

    [ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")] private class CTaskbarList { }

    [ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        // ITaskbarList
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        // ITaskbarList2
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fullscreen);
        // ITaskbarList3
        void SetProgressValue(IntPtr hwnd, ulong completed, ulong total);
        void SetProgressState(IntPtr hwnd, int flags);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint reserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] ThumbButton[] pButton);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] ThumbButton[] pButton);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
        void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string? description);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string tip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
    }

    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc proc, UIntPtr id, UIntPtr data);
    [DllImport("comctl32.dll")] private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc proc, UIntPtr id);
    [DllImport("comctl32.dll")] private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")] private static extern bool ChangeWindowMessageFilterEx(IntPtr hWnd, uint msg, uint action, IntPtr change);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr CreateIconIndirect(ref IconInfo info);
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BitmapInfo bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateBitmap(int w, int h, uint planes, uint bpp, IntPtr bits);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
}
