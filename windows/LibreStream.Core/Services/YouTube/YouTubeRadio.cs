using System.Text.Json;

namespace LibreStream.Core;

/// <summary>
/// Radio automática: la «radio» de YouTube Music a partir de una canción (lista RDAMVM + id), la misma que sale al pulsar «Iniciar radio»
/// en music.youtube.com. Solo se leen metadatos públicos (id, título, artista, duración, portada); suena con el reproductor oficial.
/// </summary>
public static partial class YouTubeMusic
{
    private const string NextUrl = "https://music.youtube.com/youtubei/v1/next?prettyPrint=false";

    /// <summary>Petición de la radio de una canción.</summary>
    public static string RadioBody(string videoId) => JsonSerializer.Serialize(new
    {
        context = Context, videoId, playlistId = "RDAMVM" + videoId, isAudioOnly = true,
    });

    /// <summary>Respuesta de la radio → canciones en su orden, sin la canción de partida ni repetidas.</summary>
    public static List<YouTubeVideo> ParseRadio(string json, string seedId = "")
    {
        var res = new List<YouTubeVideo>();
        using var doc = Open(json);
        if (doc is null) return res;
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "playlistPanelVideoRenderer") return false;
            if (v.ValueKind != JsonValueKind.Object || !v.TryGetProperty("videoId", out var idEl) || idEl.GetString() is not { } id
                || !YouTubeSearch.IsValidId(id) || id == seedId || res.Any(x => x.Id == id)) return true;
            string Runs(string prop) => v.TryGetProperty(prop, out var p) && p.TryGetProperty("runs", out var r) && r.ValueKind == JsonValueKind.Array
                ? string.Concat(r.EnumerateArray().Select(x => x.TryGetProperty("text", out var t) ? t.GetString() : "")) : "";
            var title = Runs("title").Trim();
            if (title.Length == 0) return true;
            // «Artista • Álbum • 2024» → artista (y álbum si lo hay)
            var parts = Runs("longBylineText").Split('•').Select(x => x.Trim()).Where(x => x.Length > 0 && !Year().IsMatch(x)).ToList();
            var channel = string.Join(" · ", parts.Take(2));
            var length = Runs("lengthText").Trim();
            string? art = v.TryGetProperty("thumbnail", out var th) && th.TryGetProperty("thumbnails", out var thumbs) ? ThumbUrl(thumbs) : null;
            res.Add(new YouTubeVideo(id, title, channel, Duration().IsMatch(length) ? YouTubeSearch.ParseLength(length) : 0, null, art));
            return true;
        });
        return res;
    }

    public static async Task<List<YouTubeVideo>> RadioAsync(HttpClient http, string videoId, CancellationToken ct = default)
        => ParseRadio(await PostAsync(http, NextUrl, RadioBody(videoId), ct), videoId);

    /// <summary>
    /// Qué canciones de la radio se añaden a la cola: las que no están ya (ni han sonado), solo canciones (sin directos ni vídeos
    /// largos), como mucho <paramref name="max"/>.
    /// </summary>
    public static List<YouTubeVideo> PickRadio(IEnumerable<YouTubeVideo> radio, IEnumerable<string> alreadyIds, int max = 25)
    {
        var skip = new HashSet<string>(alreadyIds);
        return radio.Where(v => v.DurationSec is > 0 and <= 900 && skip.Add(v.Id)).Take(max).ToList();
    }
}
