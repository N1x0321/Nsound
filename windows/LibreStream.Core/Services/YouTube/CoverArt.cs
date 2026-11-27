namespace LibreStream.Core;

/// <summary>
/// Carátula cuadrada oficial de una canción. Muchos vídeos de YouTube solo traen un fotograma (16:9, con el logo de «vevo»): se busca la
/// misma canción en YouTube Music, que da la portada del disco en cuadrado. Solo se usan metadatos públicos (título, artista, portada).
/// </summary>
public static class CoverArt
{
    /// <summary>¿Es ya una portada cuadrada de YouTube Music? (las del CDN de Google, no las miniaturas de vídeo de i.ytimg.com)</summary>
    public static bool IsSquare(string? art)
        => art is not null && Uri.TryCreate(art, UriKind.Absolute, out var u) && u.Scheme == "https"
           && (u.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase) || u.Host.EndsWith(".ggpht.com", StringComparison.OrdinalIgnoreCase));

    /// <summary>La misma portada en tamaño diminuto (para el fondo desenfocado); si no es de YouTube Music, null.</summary>
    public static string? Tiny(string? art, int px = 48)
    {
        if (!IsSquare(art)) return null;
        var i = art!.LastIndexOf("=w", StringComparison.Ordinal);
        return (i > 0 ? art[..i] : art) + $"=w{px}-h{px}";
    }

    /// <summary>Lo que se busca en YouTube Music para un vídeo: «artista título», sin «(Official Video)» ni el «VEVO» del canal.</summary>
    public static string Query(string videoTitle, string channel)
    {
        var (artist, title) = LyricsService.GuessTrack(videoTitle, channel);
        return $"{artist} {title}".Trim();
    }

    /// <summary>
    /// De las canciones encontradas, la que es la misma que el vídeo, con portada cuadrada: primero el mismo id; si no, mismo título
    /// (igual o contenido) y mismo artista. Null si ninguna encaja (mejor el fotograma que la portada de otra canción).
    /// </summary>
    public static YouTubeVideo? PickSong(IEnumerable<YouTubeVideo> songs, string videoId, string videoTitle, string channel)
    {
        var list = songs.Where(s => IsSquare(s.Art)).ToList();
        if (list.FirstOrDefault(s => s.Id == videoId) is { } same) return same;
        var (artist, title) = LyricsService.GuessTrack(videoTitle, channel);
        var want = MetadataMatcher.Fold(title);
        var who = MetadataMatcher.Fold(artist);
        if (want.Length == 0) return null;
        bool TitleOk(YouTubeVideo s)
        {
            var t = MetadataMatcher.Fold(MetadataMatcher.Clean(s.Title).Title);
            return t.Length > 0 && (t == want || (t.Length >= 3 && want.Contains(t, StringComparison.Ordinal)) || (want.Length >= 3 && t.Contains(want, StringComparison.Ordinal)));
        }
        bool ArtistOk(YouTubeVideo s)
        {
            if (who.Length == 0) return true;
            var a = MetadataMatcher.Fold(s.Channel.Split(" · ")[0]);
            return a.Length > 0 && (a.Contains(who, StringComparison.Ordinal) || who.Contains(a, StringComparison.Ordinal)
                || MetadataMatcher.Fold(videoTitle).Contains(a, StringComparison.Ordinal));
        }
        return list.FirstOrDefault(s => TitleOk(s) && ArtistOk(s));
    }
}
