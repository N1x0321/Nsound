using LibreStream.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace LibreStream.App;

/// <summary>Tarjeta de un álbum o de un artista de YouTube Music (al pulsar: el álbum suena entero / se abre la página del artista).</summary>
public sealed class MusicEntry
{
    public MusicAlbum? Album { get; }
    public MusicArtist? Artist { get; }
    public string Title { get; }
    public string Subtitle { get; }
    public string Initials { get; }
    public ImageSource? Artwork { get; }
    public Brush Tile { get; }
    public CornerRadius Corner { get; }

    public MusicEntry(MusicAlbum album, string? artistName = null)
    {
        Album = album;
        Title = album.Title;
        Subtitle = string.Join(" · ", new[] { string.IsNullOrEmpty(album.Artist) ? artistName ?? "" : album.Artist, album.Year, album.Kind }.Where(x => x.Length > 0));
        Initials = InitialsOf(album.Title);
        Artwork = Image(album.Art);
        Tile = Gradient(album.Id);
        Corner = new CornerRadius(12);
    }

    public MusicEntry(MusicArtist artist)
    {
        Artist = artist;
        Title = artist.Name;
        Subtitle = "Artista";
        Initials = InitialsOf(artist.Name);
        Artwork = Image(artist.Art);
        Tile = Gradient(artist.Id);
        Corner = new CornerRadius(80);   // foto redonda
    }

    private static string InitialsOf(string s) => string.Concat(s.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => char.IsLetterOrDigit(w[0])).Take(2).Select(w => char.ToUpperInvariant(w[0])));

    private static BitmapImage? Image(string? url) => Uri.TryCreate(url, UriKind.Absolute, out var u) ? new BitmapImage(u) : null;

    private static Brush Gradient(string id)
    {
        var hue = MediaCard.HueOf(id);
        var brush = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 1) };
        brush.GradientStops.Add(new GradientStop { Color = MediaCard.Hsl(hue, 0.65, 0.42), Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = MediaCard.Hsl((hue + 50) % 360, 0.70, 0.22), Offset = 1 });
        return brush;
    }
}
