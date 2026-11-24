using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;

namespace LibreStream.App;

/// <summary>
/// Mini reproductor en forma de tarjeta, siempre encima y con las esquinas redondeadas. El fondo es la portada ampliada y desenfocada,
/// con un brillo del color de la canción detrás de la carátula; mientras suena, la carátula «respira», el botón de reproducir lanza
/// ondas y unas barritas se mueven junto al artista. Debajo: título, artista, guardar, barra de progreso (se puede pinchar) y
/// Anterior / Reproducir-Pausa / Siguiente siempre visibles. Se arrastra desde la franja de arriba (doble clic: pequeña ↔ grande) y se
/// cambia de tamaño desde la esquina. No reproduce nada: la ventana principal le manda lo que suena y recibe sus pulsaciones.
/// Hecha solo con código (sin XAML).
/// </summary>
public sealed class MiniPlayerWindow : Window
{
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out CursorPoint p);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] private struct CursorPoint { public int X, Y; }

    private const double DesignW = 340, DesignH = 500;   // tamaño de diseño: todo lo demás se escala a partir de él

    private readonly Image _backdrop = new() { Stretch = Stretch.UniformToFill, Opacity = 0.75, IsHitTestVisible = false };
    private readonly Image _art = new() { Stretch = Stretch.UniformToFill };
    private readonly Grid _artTile = new() { Width = 214, Height = 214, CornerRadius = new CornerRadius(22), HorizontalAlignment = HorizontalAlignment.Center, RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5) };
    private readonly ScaleTransform _artScale = new();
    private readonly GradientStop _glowStop = new() { Offset = 0.25 };
    private readonly GradientStop _glowEnd = new() { Offset = 1 };
    private readonly SolidColorBrush _glowBrush = new(Windows.UI.Color.FromArgb(255, 0xFF, 0x4D, 0x62));
    private readonly TextBlock _title = new() { FontSize = 19, FontWeight = Microsoft.UI.Text.FontWeights.Bold, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly TextBlock _artist = new() { FontSize = 13, Opacity = 0.72, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _keyBpm = new() { FontSize = 11, Opacity = 0.55, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly StackPanel _eq = new() { Orientation = Orientation.Horizontal, Spacing = 2, Height = 12, VerticalAlignment = VerticalAlignment.Center, Visibility = Visibility.Collapsed };
    private readonly Slider _slider = new() { Minimum = 0, Maximum = 1, IsThumbToolTipEnabled = false };
    private readonly TextBlock _elapsed = new() { FontSize = 11, Opacity = 0.7, Text = "0:00" };
    private readonly TextBlock _total = new() { FontSize = 11, Opacity = 0.7, Text = "0:00", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly FontIcon _playIcon = new() { Glyph = "\uE768", FontSize = 24 };   // E768 = reproducir, E769 = pausa
    private readonly Ellipse _halo = new() { Width = 64, Height = 64, Opacity = 0, IsHitTestVisible = false, RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5) };
    private readonly ScaleTransform _haloScale = new();
    private readonly Button _save = new() { Width = 40, Height = 40, Padding = new Thickness(0), CornerRadius = new CornerRadius(20), VerticalAlignment = VerticalAlignment.Center, BorderThickness = new Thickness(0) };
    private readonly Grid _root = new();
    private readonly Storyboard _pulse = new();
    private bool _setting, _scrubbing, _small, _pulsing;
    private string? _trackId;

    public MiniPlayerWindow(Action previous, Action playPause, Action next, Action expand, Action<double> seek, Action save, ElementTheme theme)
    {
        Title = "Nsound";
        _root.Width = DesignW; _root.Height = DesignH;

        // Sin barra de título ni borde, siempre encima; Windows 11 le redondea las esquinas
        if (AppWindow.Presenter is OverlappedPresenter p)
        {
            p.SetBorderAndTitleBar(true, false);   // con borde de DWM (se pinta del color del fondo) y sin barra de título
            p.IsAlwaysOnTop = true;
            p.IsMaximizable = false;
            p.IsMinimizable = false;
            p.IsResizable = false;
        }
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        void Frame()
        {
            try
            {
                var bgc = ((SolidColorBrush)Application.Current.Resources["NsBgBrush"]).Color;
                var round = 2; DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int));                       // esquinas redondeadas
                var edge = bgc.R | bgc.G << 8 | bgc.B << 16; DwmSetWindowAttribute(hwnd, 34, ref edge, sizeof(int));   // el filo del borde, del color del fondo
            }
            catch { /* Windows 10: esquinas rectas */ }
        }
        Frame();
        Activated += (_, _) => Frame();   // WinUI vuelve a pintar el marco al mostrarse
        var scale = Math.Max(1.0, GetDpiForWindow(hwnd) / 96.0);
        void SetWidth(double dips) => AppWindow.ResizeClient(new Windows.Graphics.SizeInt32((int)(dips * scale), (int)(dips * DesignH / DesignW * scale)));   // misma proporción siempre
        SetWidth(300);
        try { AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico")); } catch { /* sin icono: se queda el predeterminado */ }

        var bg = ((SolidColorBrush)Application.Current.Resources["NsBgBrush"]).Color;
        var accent = (Brush)Application.Current.Resources["NsAccentBrush"];
        var onAccent = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];
        Windows.UI.Color Bg(byte a) => Windows.UI.Color.FromArgb(a, bg.R, bg.G, bg.B);

        Button Icon(string glyph, Action click, string name, double size = 18, double box = 40)
        {
            var b = new Button { Content = new FontIcon { Glyph = glyph, FontSize = size }, Width = box, Height = box, Padding = new Thickness(0),
                CornerRadius = new CornerRadius(box / 2), Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) };
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(b, name);
            ToolTipService.SetToolTip(b, name);
            b.Click += (_, _) => click();
            return b;
        }

        // Capas del fondo: color de la app, portada desenfocada, brillo de la canción y un velo que se oscurece hacia abajo
        _root.Background = new SolidColorBrush(bg);
        _root.Children.Add(_backdrop);
        _root.Children.Add(new Rectangle
        {
            IsHitTestVisible = false,
            Fill = new LinearGradientBrush
            {
                StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1),
                GradientStops = { new GradientStop { Color = Bg(0x40), Offset = 0 }, new GradientStop { Color = Bg(0xE6), Offset = 0.58 }, new GradientStop { Color = Bg(0xFF), Offset = 1 } },
            },
        });
        _root.Children.Add(new Rectangle
        {
            Height = 330, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(-30, -20, -30, 0), IsHitTestVisible = false,
            Fill = new RadialGradientBrush { GradientStops = { _glowStop, _glowEnd } },
        });

        var content = new StackPanel();
        _root.Children.Add(content);

        // Franja de arriba: asa para arrastrar, volver a Nsound y cerrar
        var top = new Grid { Height = 42, Background = new SolidColorBrush(Colors.Transparent) };
        top.Children.Add(new Rectangle { Width = 36, Height = 4, RadiusX = 2, RadiusY = 2, Opacity = 0.45, Fill = (Brush)Application.Current.Resources["TextFillColorPrimaryBrush"], VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 9, 0, 0) });
        top.PointerPressed += (_, _) => { ReleaseCapture(); SendMessage(hwnd, 0xA1, (IntPtr)2, IntPtr.Zero); };   // arrastrar la ventana como si fuera la barra de título
        top.DoubleTapped += (_, _) => { _small = !_small; SetWidth(_small ? 230 : 340); };
        var expandBtn = Icon("\uE73F", expand, "Volver a Nsound", 14, 32); expandBtn.HorizontalAlignment = HorizontalAlignment.Left; expandBtn.Margin = new Thickness(8, 4, 0, 0);
        var closeBtn = Icon("\uE711", () => Close(), "Cerrar el mini reproductor", 13, 32); closeBtn.HorizontalAlignment = HorizontalAlignment.Right; closeBtn.Margin = new Thickness(0, 4, 8, 0);
        top.Children.Add(expandBtn); top.Children.Add(closeBtn);
        content.Children.Add(top);

        // Carátula
        _artTile.RenderTransform = _artScale;
        _artTile.Children.Add(new FontIcon { Glyph = "\uE8D6", FontSize = 54, Opacity = 0.5 });
        _art.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(350) };
        _artTile.Children.Add(_art);
        _artTile.Margin = new Thickness(0, 4, 0, 0);
        content.Children.Add(_artTile);

        // Título, artista (con barritas mientras suena) y guardar
        var info = new Grid { Margin = new Thickness(24, 20, 20, 0), ColumnSpacing = 10 };
        info.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        info.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        foreach (var h in new[] { 0.6, 1.0, 0.4 })
        {
            var bar = new Rectangle { Width = 3, Height = 12, RadiusX = 1.5, RadiusY = 1.5, Fill = _glowBrush, RenderTransformOrigin = new Windows.Foundation.Point(0.5, 1), RenderTransform = new ScaleTransform { ScaleY = h } };
            _eq.Children.Add(bar);
        }
        var sub = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        sub.Children.Add(_eq); sub.Children.Add(_artist);
        var texts = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(_title); texts.Children.Add(sub);
        info.Children.Add(texts);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(_save, "Guardar en Mi biblioteca");
        ToolTipService.SetToolTip(_save, "Guardar en Mi biblioteca");
        _save.Click += (_, _) => save();
        Grid.SetColumn(_save, 1); info.Children.Add(_save);
        content.Children.Add(info);

        // Progreso (se puede pinchar o arrastrar) y tiempos
        var progress = new StackPanel { Margin = new Thickness(20, 8, 20, 0) };
        _slider.ValueChanged += (_, e) => { if (!_setting) seek(e.NewValue); };
        _slider.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => _scrubbing = true), true);
        _slider.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        _slider.AddHandler(UIElement.PointerCanceledEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        _slider.AddHandler(UIElement.PointerCaptureLostEvent, new PointerEventHandler((_, _) => _scrubbing = false), true);
        var times = new Grid { Margin = new Thickness(4, -6, 4, 0) };
        times.Children.Add(_elapsed); times.Children.Add(_total);
        progress.Children.Add(_slider); progress.Children.Add(times);
        content.Children.Add(progress);

        // Controles: Anterior · Reproducir/Pausa (con ondas) · Siguiente
        var playBtn = new Button { Content = _playIcon, Width = 64, Height = 64, Padding = new Thickness(0), CornerRadius = new CornerRadius(32), Background = accent, BorderThickness = new Thickness(0) };
        _playIcon.Foreground = onAccent;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(playBtn, "Reproducir o pausar");
        playBtn.Click += (_, _) => playPause();
        _halo.Fill = accent;
        _halo.RenderTransform = _haloScale;
        var playHost = new Grid { Width = 64, Height = 64 };
        playHost.Children.Add(_halo); playHost.Children.Add(playBtn);
        var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 22, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };
        controls.Children.Add(Icon("\uE892", previous, "Anterior", 20, 48));
        controls.Children.Add(playHost);
        controls.Children.Add(Icon("\uE893", next, "Siguiente", 20, 48));
        content.Children.Add(controls);
        _keyBpm.Margin = new Thickness(20, 8, 20, 0);
        content.Children.Add(_keyBpm);

        SetSaved(false);
        _root.RequestedTheme = theme;
        BuildPulse();

        // Tirador de la esquina de abajo a la derecha: arrastrando se cambia el tamaño (de 200 a 640 puntos de ancho)
        var grip = new Border { Width = 30, Height = 30, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Colors.Transparent) };
        grip.Child = new TextBlock { Text = "◢", FontSize = 12, Opacity = 0.35, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 7, 5) };
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
        var host = new Grid { Background = new SolidColorBrush(bg) };
        host.Children.Add(new Viewbox { Stretch = Stretch.Uniform, Child = _root });
        host.Children.Add(grip);
        Content = host;
        SetGlow(((SolidColorBrush)accent).Color);
    }

    private void BuildPulse()
    {
        void Add(DependencyObject target, string prop, double from, double to, double secs, bool reverse = true)
        {
            var a = new DoubleAnimation
            {
                From = from, To = to, Duration = TimeSpan.FromSeconds(secs), AutoReverse = reverse, RepeatBehavior = RepeatBehavior.Forever,
                EnableDependentAnimation = true, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            };
            Storyboard.SetTarget(a, target);
            Storyboard.SetTargetProperty(a, prop);
            _pulse.Children.Add(a);
        }
        foreach (var prop in new[] { "ScaleX", "ScaleY" })
        {
            Add(_artScale, prop, 1, 1.04, 2.2);
            Add(_haloScale, prop, 1, 1.5, 1.8, reverse: false);
        }
        Add(_halo, "Opacity", 0.45, 0, 1.8, reverse: false);
        var secs = new[] { 0.42, 0.58, 0.36 };
        for (var i = 0; i < _eq.Children.Count; i++)
            Add(((FrameworkElement)_eq.Children[i]).RenderTransform, "ScaleY", 0.2, 1, secs[i]);
    }

    /// <summary>Lo que suena ahora. Las imágenes solo se cambian al cambiar de canción (sin parpadeos en cada actualización).</summary>
    public void SetTrack(string id, string title, string artist, ImageSource? art, Brush? tile, ImageSource? backdrop, bool playing)
    {
        _title.Text = string.IsNullOrWhiteSpace(title) ? "Nada en reproducción" : title;
        _artist.Text = artist;
        if (id != _trackId)
        {
            _trackId = id;
            _artTile.Background = tile;
            _backdrop.Source = backdrop;
            _art.Opacity = 0;
            _art.Source = art;
            DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => _art.Opacity = 1);
        }
        SetPlaying(playing);
    }

    /// <summary>Color de la canción (sale de la portada): tiñe el brillo de detrás de la carátula y las barritas.</summary>
    public void SetGlow(Windows.UI.Color c)
    {
        Animate(_glowStop, Windows.UI.Color.FromArgb(0x90, c.R, c.G, c.B));
        Animate(_glowEnd, Windows.UI.Color.FromArgb(0, c.R, c.G, c.B));
        Animate(_glowBrush, c);

        static void Animate(DependencyObject target, Windows.UI.Color to)
        {
            var a = new ColorAnimation { To = to, Duration = TimeSpan.FromMilliseconds(900), EnableDependentAnimation = true, EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut } };
            Storyboard.SetTarget(a, target);
            Storyboard.SetTargetProperty(a, "Color");
            var sb = new Storyboard();
            sb.Children.Add(a);
            sb.Begin();
        }
    }

    /// <summary>Tono y BPM detectados («La menor · 128 BPM»); vacío si aún no hay dato fiable.</summary>
    public void SetKeyBpm(string text) => _keyBpm.Text = text;

    public void SetPlaying(bool playing)
    {
        _playIcon.Glyph = playing ? "\uE769" : "\uE768";
        _playIcon.Margin = new Thickness(playing ? 0 : 3, 0, 0, 0);   // el triángulo se ve centrado
        _eq.Visibility = playing ? Visibility.Visible : Visibility.Collapsed;
        if (playing == _pulsing) return;
        _pulsing = playing;
        if (playing) _pulse.Begin(); else _pulse.Stop();
    }

    /// <summary>Guardado: corazón relleno sobre el color de la app; sin guardar: corazón vacío.</summary>
    public void SetSaved(bool saved)
    {
        var heart = new FontIcon { Glyph = saved ? "\uEB52" : "\uEB51", FontSize = 17 };
        if (saved) heart.Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];   // sin guardar: el color del texto
        _save.Content = heart;
        _save.Background = saved ? (Brush)Application.Current.Resources["NsAccentBrush"] : new SolidColorBrush(Colors.Transparent);
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
