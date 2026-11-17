using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace LibreStream.App;

/// <summary>
/// Mini reproductor: una ventana pequeña que siempre queda por encima de las demás, con la portada, el título, el artista, la barra de
/// progreso y los botones Anterior / Reproducir-Pausa / Siguiente. No reproduce nada: la ventana principal le manda lo que suena
/// y recibe sus pulsaciones. Está hecha solo con código (sin XAML) para que sea una pieza pequeña y fácil de mantener.
/// </summary>
public sealed class MiniPlayerWindow : Window
{
    private readonly Image _art = new() { Width = 84, Height = 84, Stretch = Stretch.UniformToFill };
    private readonly Border _artTile = new() { Width = 84, Height = 84, CornerRadius = new CornerRadius(12) };
    private readonly TextBlock _title = new() { FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly TextBlock _artist = new() { FontSize = 12, Opacity = 0.7, TextTrimming = TextTrimming.CharacterEllipsis, MaxLines = 1 };
    private readonly ProgressBar _progress = new() { Minimum = 0, Maximum = 1, Height = 4, MinHeight = 4 };
    private readonly TextBlock _elapsed = new() { FontSize = 11, Opacity = 0.65, Text = "0:00" };
    private readonly TextBlock _total = new() { FontSize = 11, Opacity = 0.65, Text = "0:00", HorizontalAlignment = HorizontalAlignment.Right };
    private readonly FontIcon _playIcon = new() { Glyph = "", FontSize = 18 };   // E768 = reproducir, E769 = pausa
    private readonly Grid _root = new();

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hWnd);

    public MiniPlayerWindow(Action previous, Action playPause, Action next, Action expand, ElementTheme theme)
    {
        Title = "Nsound";

        // Siempre encima, sin maximizar ni redimensionar, con un tamaño fijo y cómodo
        if (AppWindow.Presenter is OverlappedPresenter p)
        {
            p.IsAlwaysOnTop = true;
            p.IsMaximizable = false;
            p.IsResizable = false;
        }
        // Tamaño del área de contenido en puntos de la interfaz (420 × 150), pasado a píxeles con la escala de la pantalla: así no se corta nada con el 125 % o el 150 %
        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var scale = Math.Max(1.0, GetDpiForWindow(hwnd) / 96.0);
        AppWindow.ResizeClient(new Windows.Graphics.SizeInt32((int)(420 * scale), (int)(150 * scale)));
        try { AppWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "icon.ico")); } catch { /* sin icono: se queda el predeterminado */ }

        _artTile.Child = _art;
        Button Make(string glyph, Action click, string name, double size = 18, bool main = false)
        {
            var icon = glyph == "play" ? _playIcon : new FontIcon { Glyph = glyph, FontSize = size };
            var b = new Button
            {
                Content = icon, Width = main ? 52 : 44, Height = main ? 52 : 44, Padding = new Thickness(0), CornerRadius = new CornerRadius(main ? 26 : 22),
                Background = main ? (Brush)Application.Current.Resources["NsAccentBrush"] : new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0),
            };
            if (main) b.Foreground = new SolidColorBrush(Colors.White);
            Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(b, name);
            ToolTipService.SetToolTip(b, name);
            b.Click += (_, _) => click();
            return b;
        }

        var controls = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, HorizontalAlignment = HorizontalAlignment.Left };
        controls.Children.Add(Make("", previous, "Anterior"));
        controls.Children.Add(Make("play", playPause, "Reproducir o pausar", 20, main: true));
        controls.Children.Add(Make("", next, "Siguiente"));

        var expandBtn = Make("", expand, "Volver a Nsound", 15);   // E740 = pantalla completa
        expandBtn.HorizontalAlignment = HorizontalAlignment.Right;
        expandBtn.VerticalAlignment = VerticalAlignment.Top;
        expandBtn.Width = expandBtn.Height = 32;

        var times = new Grid { ColumnSpacing = 8 };
        times.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        times.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        times.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        times.Children.Add(_elapsed);
        Grid.SetColumn(_progress, 1); _progress.VerticalAlignment = VerticalAlignment.Center; times.Children.Add(_progress);
        Grid.SetColumn(_total, 2); times.Children.Add(_total);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_title);
        text.Children.Add(_artist);

        var right = new Grid { RowSpacing = 6, VerticalAlignment = VerticalAlignment.Center };
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        right.Children.Add(text);
        Grid.SetRow(times, 1); right.Children.Add(times);
        Grid.SetRow(controls, 2); right.Children.Add(controls);

        _root.Padding = new Thickness(14, 12, 14, 12);
        _root.ColumnSpacing = 14;
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var artHost = new Grid { VerticalAlignment = VerticalAlignment.Top };
        artHost.Children.Add(_artTile);
        _root.Children.Add(artHost);
        Grid.SetColumn(right, 1); _root.Children.Add(right);
        Grid.SetColumn(expandBtn, 1); _root.Children.Add(expandBtn);

        _root.Background = (Brush)Application.Current.Resources["NsBgBrush"];   // el mismo color de fondo que la ventana principal
        _root.RequestedTheme = theme;
        Content = _root;
    }

    /// <summary>Lo que suena ahora (título, artista, portada) y si está sonando.</summary>
    public void SetTrack(string title, string artist, ImageSource? art, Brush? tile, bool playing)
    {
        _title.Text = string.IsNullOrWhiteSpace(title) ? "Nada en reproducción" : title;
        _artist.Text = artist;
        _art.Source = art;
        _artTile.Background = tile;
        SetPlaying(playing);
    }

    public void SetPlaying(bool playing) => _playIcon.Glyph = playing ? "" : "";

    public void SetProgress(TimeSpan position, TimeSpan total)
    {
        _progress.Maximum = Math.Max(1, total.TotalSeconds);
        _progress.Value = Math.Min(position.TotalSeconds, _progress.Maximum);
        _elapsed.Text = MediaCard.Format(position);
        _total.Text = MediaCard.Format(total);
    }

    public void SetTheme(ElementTheme theme) => _root.RequestedTheme = theme;
}
