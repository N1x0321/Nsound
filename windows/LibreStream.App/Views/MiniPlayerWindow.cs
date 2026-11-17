using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace LibreStream.App;

/// <summary>
/// Mini reproductor en forma de tarjeta: sin barra de título, siempre encima, con la portada grande sobre un fondo teñido con su color.
/// Al pasar el ratón por la portada aparecen Anterior / Reproducir-Pausa / Siguiente; la barra de progreso se puede pinchar para saltar;
/// debajo van el título, el artista y la marca de guardado. Se arrastra desde la franja de arriba. No reproduce nada: la ventana
/// principal le manda lo que suena y recibe sus pulsaciones. Hecha solo con código (sin XAML).
/// </summary>
public sealed class MiniPlayerWindow : Window
{
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out CursorPoint p);
    [StructLayout(LayoutKind.Sequential)] private struct CursorPoint { public int X, Y; }
    private const double DesignW = 360, DesignH = 430;   // tamaño de diseño: todo lo demás se escala a partir de él
    private double _scale = 1;
    private bool _small;
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private readonly Image _art = new() { Stretch = Stretch.UniformToFill };
    private readonly Border _artTile = new() { Width = 236, Height = 236, CornerRadius = new CornerRadius(16), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 18, 0, 0) };
    private readonly Rectangle _tint = new() { Opacity = 0.55 };
    private readonly Border _scrim = new() { Opacity = 0, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x66, 0, 0, 0)) };
    private readonly TextBlock _title = new() { FontSize = 24, FontWeight = Microsoft.UI.Text.FontWeights.Bold, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly TextBlock _artist = new() { FontSize = 13, Opacity = 0.75, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly Slider _slider = new() { Minimum = 0, Maximum = 1, IsThumbToolTipEnabled = false, Height = 28 };
    private readonly TextBlock _elapsed = new() { FontSize = 12, Opacity = 0.75, Text = "0:00" };
    private readonly TextBlock _total = new() { FontSize = 12, Opacity = 0.75, Text = "0:00", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly FontIcon _playIcon = new() { Glyph = "", FontSize = 26 };   // E768 = reproducir, E769 = pausa
    private readonly Button _save = new() { Width = 38, Height = 38, Padding = new Thickness(0), CornerRadius = new CornerRadius(19), VerticalAlignment = VerticalAlignment.Center };
    private readonly Grid _root = new();
    private bool _setting, _scrubbing;

    public MiniPlayerWindow(Action previous, Action playPause, Action next, Action expand, Action<double> seek, Action save, ElementTheme theme)
    {
        Title = "Nsound";
        _root.Width = DesignW; _root.Height = DesignH;

        // Sin barra de título ni borde, siempre encima, tamaño fijo
        if (AppWindow.Presenter is OverlappedPresenter p)
        {
            p.SetBorderAndTitleBar(false, false);
            p.IsAlwaysOnTop = true;
            p.IsMaximizable = false;
            p.IsMinimizable = false;
            p.IsResizable = false;
        }
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var scale = Math.Max(1.0, GetDpiForWindow(hwnd) / 96.0);
        _scale = scale;
        void SetWidth(double dips) => AppWindow.ResizeClient(new Windows.Graphics.SizeInt32((int)(dips * scale), (int)(dips * DesignH / DesignW * scale)));   // puntos × escala de la pantalla, siempre con la misma proporción
        SetWidth(300);
        try { AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico")); } catch { /* sin icono: se queda el predeterminado */ }

        var bgColor = ((SolidColorBrush)Application.Current.Resources["NsBgBrush"]).Color;
        static Brush White(byte a = 255) => new SolidColorBrush(Windows.UI.Color.FromArgb(a, 255, 255, 255));

        Button Icon(string glyph, Action click, string name, double size = 18, double box = 40)
        {
            var b = new Button { Content = new FontIcon { Glyph = glyph, FontSize = size, Foreground = White() }, Width = box, Height = box, Padding = new Thickness(0),
                CornerRadius = new CornerRadius(box / 2), Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(b, name);
            ToolTipService.SetToolTip(b, name);
            b.Click += (_, _) => click();
            return b;
        }

        // Fondo: el color de la portada, que se apaga hacia abajo hasta el color de la app
        var fade = new Rectangle { Fill = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1),
            GradientStops = { new GradientStop { Color = Windows.UI.Color.FromArgb(0, bgColor.R, bgColor.G, bgColor.B), Offset = 0.30 }, new GradientStop { Color = bgColor, Offset = 0.78 } },
        } };
        _root.Background = new SolidColorBrush(bgColor);
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(278) });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        foreach (var r in new[] { _tint, fade }) { Grid.SetRowSpan(r, 3); _root.Children.Add(r); }

        // Portada con los controles encima (aparecen al pasar el ratón)
        var cover = new Grid { Background = new SolidColorBrush(Colors.Transparent) };
        _artTile.Child = _art;
        cover.Children.Add(_artTile);

        _scrim.OpacityTransition = new ScalarTransition();
        _scrim.CornerRadius = new CornerRadius(16);
        _scrim.Width = _artTile.Width; _scrim.Height = _artTile.Height;
        _scrim.HorizontalAlignment = HorizontalAlignment.Center; _scrim.VerticalAlignment = VerticalAlignment.Center; _scrim.Margin = _artTile.Margin;
        var playBtn = new Button { Content = _playIcon, Width = 64, Height = 64, Padding = new Thickness(0), CornerRadius = new CornerRadius(32), Background = White(), BorderThickness = new Thickness(0) };
        _playIcon.Foreground = new SolidColorBrush(Colors.Black);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(playBtn, "Reproducir o pausar");
        playBtn.Click += (_, _) => playPause();
        var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        controls.Children.Add(Icon("", previous, "Anterior", 22, 48));
        controls.Children.Add(playBtn);
        controls.Children.Add(Icon("", next, "Siguiente", 22, 48));
        _scrim.Child = controls;
        cover.Children.Add(_scrim);
        cover.PointerEntered += (_, _) => _scrim.Opacity = 1;
        cover.PointerExited += (_, _) => _scrim.Opacity = 0;

        // Franja de arriba: asa para arrastrar, volver a Nsound y cerrar
        var top = new Grid { Height = 44, VerticalAlignment = VerticalAlignment.Top, Background = new SolidColorBrush(Colors.Transparent) };
        top.Children.Add(new Rectangle { Width = 38, Height = 4, RadiusX = 2, RadiusY = 2, Fill = White(110), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 9, 0, 0) });
        top.PointerPressed += (_, _) => { ReleaseCapture(); SendMessage(hwnd, 0xA1, (IntPtr)2, IntPtr.Zero); };   // arrastrar la ventana como si fuera la barra de título
        top.DoubleTapped += (_, _) => { _small = !_small; SetWidth(_small ? 230 : 360); };                         // doble clic en la franja: pequeña ↔ grande
        var expandBtn = Icon("", expand, "Volver a Nsound", 15, 34); expandBtn.HorizontalAlignment = HorizontalAlignment.Left; expandBtn.Margin = new Thickness(8, 4, 0, 0);
        var closeBtn = Icon("", () => Close(), "Cerrar el mini reproductor", 14, 34); closeBtn.HorizontalAlignment = HorizontalAlignment.Right; closeBtn.Margin = new Thickness(0, 4, 8, 0);
        top.Children.Add(expandBtn); top.Children.Add(closeBtn);
        cover.Children.Add(top);
        _root.Children.Add(cover);

        // Progreso (se puede pinchar o arrastrar) y tiempos
        var progress = new StackPanel { Margin = new Thickness(22, 0, 22, 0), Spacing = 0 };
        _slider.ValueChanged += (_, e) => { if (!_setting) seek(e.NewValue); };
        _slider.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => _scrubbing = true), true);
        _slider.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        _slider.AddHandler(UIElement.PointerCanceledEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        _slider.AddHandler(UIElement.PointerCaptureLostEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        var times = new Grid { Margin = new Thickness(0, -4, 0, 0) };
        times.Children.Add(_elapsed); times.Children.Add(_total);
        progress.Children.Add(_slider); progress.Children.Add(times);
        Grid.SetRow(progress, 1); _root.Children.Add(progress);

        // Título, artista y marca de guardado
        var info = new Grid { Margin = new Thickness(22, 12, 22, 16), ColumnSpacing = 12 };
        info.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        info.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var sub = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        sub.Children.Add(new FontIcon { Glyph = "", FontSize = 13, Opacity = 0.75, VerticalAlignment = VerticalAlignment.Center });
        sub.Children.Add(_artist);
        var texts = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(_title); texts.Children.Add(sub);
        info.Children.Add(texts);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(_save, "Guardar en Mi biblioteca");
        ToolTipService.SetToolTip(_save, "Guardar en Mi biblioteca");
        _save.Click += (_, _) => save();
        Grid.SetColumn(_save, 1); info.Children.Add(_save);
        Grid.SetRow(info, 2); _root.Children.Add(info);
        SetSaved(false);

        _root.RequestedTheme = theme;

        // Tirador de la esquina de abajo a la derecha: arrastrando con el ratón se cambia el tamaño (mínimo 200, máximo 640 puntos de ancho)
        var grip = new Border { Width = 30, Height = 30, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Colors.Transparent) };
        grip.Child = new TextBlock { Text = "◢", FontSize = 13, Opacity = 0.55, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 6, 4) };
        ToolTipService.SetToolTip(grip, "Arrastra para cambiar el tamaño · doble clic arriba: pequeña o grande");
        CursorPoint start = default; int startW = 0;
        grip.PointerPressed += (_, e) => { grip.CapturePointer(e.Pointer); GetCursorPos(out start); startW = AppWindow.ClientSize.Width; };
        grip.PointerMoved += (_, e) =>
        {
            if (!e.GetCurrentPoint(grip).Properties.IsLeftButtonPressed) return;
            GetCursorPos(out var now);
            var w = Math.Clamp(startW + (now.X - start.X), (int)(200 * scale), (int)(640 * scale));
            AppWindow.ResizeClient(new Windows.Graphics.SizeInt32(w, (int)(w * DesignH / DesignW)));
        };
        grip.PointerReleased += (_, e) => grip.ReleasePointerCapture(e.Pointer);

        // Todo el contenido se escala con la ventana (ancho y alto a la vez)
        var host = new Grid();
        host.Children.Add(new Viewbox { Stretch = Stretch.Uniform, Child = _root });
        host.Children.Add(grip);
        Content = host;
    }

    /// <summary>Lo que suena ahora (título, artista, portada) y si está sonando.</summary>
    public void SetTrack(string title, string artist, ImageSource? art, Brush? tile, bool playing)
    {
        _title.Text = string.IsNullOrWhiteSpace(title) ? "Nada en reproducción" : title;
        _artist.Text = artist;
        _art.Source = art;
        _artTile.Background = tile;
        _tint.Fill = tile;
        SetPlaying(playing);
    }

    public void SetPlaying(bool playing) => _playIcon.Glyph = playing ? "" : "";

    /// <summary>Guardado: círculo del color de la app con una marca; sin guardar: círculo con borde y un +.</summary>
    public void SetSaved(bool saved)
    {
        var accent = (Brush)Application.Current.Resources["NsAccentBrush"];
        _save.Content = new FontIcon { Glyph = saved ? "" : "", FontSize = 17, Foreground = new SolidColorBrush(Colors.White) };
        _save.Background = saved ? accent : new SolidColorBrush(Colors.Transparent);
        _save.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(150, 255, 255, 255));
        _save.BorderThickness = new Thickness(saved ? 0 : 1.5);
    }

    public void SetProgress(TimeSpan position, TimeSpan total)
    {
        _elapsed.Text = MediaCard.Format(position);
        _total.Text = MediaCard.Format(total);
        if (_scrubbing) return;                 // mientras el usuario arrastra, no se le mueve la barra
        _setting = true;
        _slider.Maximum = Math.Max(1, total.TotalSeconds);
        _slider.Value = Math.Min(position.TotalSeconds, _slider.Maximum);
        _setting = false;
    }

    public void SetTheme(ElementTheme theme) => _root.RequestedTheme = theme;
}
