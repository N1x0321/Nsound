using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LibreStream.Core;

/// <summary>Un álbum, EP o single de YouTube Music (Id = «MPREb_…»).</summary>
public sealed record MusicAlbum(string Id, string Title, string Kind, string Artist, string Year, string? Art);

/// <summary>Un artista de YouTube Music (Id = «UC…»).</summary>
public sealed record MusicArtist(string Id, string Name, string? Art);

/// <summary>Página de un artista: sus canciones más escuchadas, la lista «todas las canciones» (VL…) y sus discos.</summary>
public sealed record MusicArtistPage(List<YouTubeVideo> Songs, string AllSongsId, List<MusicAlbum> Releases);

/// <summary>Filtros «Álbumes» y «Artistas» de la búsqueda de YouTube Music, discos y página de artista (solo metadatos públicos).</summary>
public static partial class YouTubeMusic
{
    /// <summary>Mismos <c>params</c> InnerTube (WEB_REMIX) que la versión web/móvil.</summary>
    public const string AlbumsFilter = "EgWKAQIYAWoMEA4QChADEAQQCRAF";
    public const string ArtistsFilter = "EgWKAQIgAWoMEA4QChADEAQQCRAF";
    private const string BrowseUrl = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false";

    [GeneratedRegex(@"^(19|20)\d{2}$")]
    private static partial Regex Year();

    private static object Context => new { client = new { clientName = "WEB_REMIX", clientVersion = "1.20241106.01.00", hl = "es", gl = "ES" } };

    public static string SearchBody(string query, string filter) => JsonSerializer.Serialize(new { context = Context, query = query.Trim(), @params = filter });

    /// <summary>Una página de YouTube Music: un álbum (MPREb_…), un artista (UC…) o una lista (VL…).</summary>
    public static string BrowseBody(string browseId, string? country = null)
    {
        // país (dos letras): las listas de éxitos cambian según el país
        var body = new Dictionary<string, object> { ["context"] = Context, ["browseId"] = browseId };
        if (country is not null && CountryCode().IsMatch(country)) body["formData"] = new { selectedValues = new[] { country } };
        return JsonSerializer.Serialize(body);
    }

    [GeneratedRegex(@"^[A-Z]{2}$")]
    private static partial Regex CountryCode();

    public static bool IsBrowseId(string? id) => id is not null && BrowseId().IsMatch(id);

    [GeneratedRegex(@"^(MPRE[\w-]{4,60}|UC[\w-]{20,30}|VL[\w-]{6,60})$")]
    private static partial Regex BrowseId();

    private static async Task<string> PostAsync(HttpClient http, string url, string body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.TryAddWithoutValidation("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        req.Headers.TryAddWithoutValidation("Origin", "https://music.youtube.com");
        req.Headers.TryAddWithoutValidation("Referer", "https://music.youtube.com/");
        req.Headers.TryAddWithoutValidation("Accept-Language", "es-ES,es;q=0.9");
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadAsStringAsync(ct);
    }

    public static async Task<List<MusicAlbum>> SearchAlbumsAsync(HttpClient http, string query, CancellationToken ct = default)
        => ParseAlbums(await PostAsync(http, SearchUrl, SearchBody(query, AlbumsFilter), ct));

    public static async Task<List<MusicArtist>> SearchArtistsAsync(HttpClient http, string query, CancellationToken ct = default)
        => ParseArtists(await PostAsync(http, SearchUrl, SearchBody(query, ArtistsFilter), ct));

    /// <summary>Canciones de un álbum (o de la lista «todas las canciones» de un artista).</summary>
    public static async Task<List<YouTubeVideo>> BrowseTracksAsync(HttpClient http, string browseId, string artist = "", string album = "", string? art = null, CancellationToken ct = default)
        => ParseTracks(await PostAsync(http, BrowseUrl, BrowseBody(browseId), ct), artist, album, art);

    public static async Task<MusicArtistPage> BrowseArtistAsync(HttpClient http, string browseId, string artist, CancellationToken ct = default)
        => ParseArtistPage(await PostAsync(http, BrowseUrl, BrowseBody(browseId), ct), artist);

    // ---------- Lectura de las respuestas ----------

    private static JsonDocument? Open(string json)
    {
        try { return JsonDocument.Parse(json); }
        catch (JsonException) { return null; }
    }

    /// <summary>Recorre el JSON; si <paramref name="visit"/> devuelve true, no baja dentro de ese nodo.</summary>
    private static void WalkNodes(JsonElement e, Func<string, JsonElement, bool> visit, int depth = 0)
    {
        if (depth > 40) return;
        if (e.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in e.EnumerateObject())
                if (!visit(p.Name, p.Value)) WalkNodes(p.Value, visit, depth + 1);
        }
        else if (e.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in e.EnumerateArray()) WalkNodes(x, visit, depth + 1);
        }
    }

    private static string? BrowseIdOf(JsonElement r)
        => r.TryGetProperty("navigationEndpoint", out var ne) && ne.TryGetProperty("browseEndpoint", out var be)
           && be.TryGetProperty("browseId", out var id) && id.ValueKind == JsonValueKind.String && IsBrowseId(id.GetString()) ? id.GetString() : null;

    private static string? ThumbUrl(JsonElement thumbs)
    {
        if (thumbs.ValueKind != JsonValueKind.Array || thumbs.GetArrayLength() == 0) return null;
        return thumbs[thumbs.GetArrayLength() - 1].TryGetProperty("url", out var u) && u.GetString() is { } url
               && url.StartsWith("https://", StringComparison.Ordinal) ? ArtSize().Replace(url, "=w544-h544") : null;
    }

    private static string? RowArt(JsonElement r)
        => r.TryGetProperty("thumbnail", out var th) && th.TryGetProperty("musicThumbnailRenderer", out var mt)
           && mt.TryGetProperty("thumbnail", out var t2) && t2.TryGetProperty("thumbnails", out var thumbs) ? ThumbUrl(thumbs) : null;

    private static bool IsDot(string t) => t.Length == 0 || t.All(c => char.IsWhiteSpace(c) || c is '•' or '·');

    /// <summary>Búsqueda con el filtro «Álbumes» → álbumes con tipo («Álbum», «EP», «Sencillo»), artista y año.</summary>
    public static List<MusicAlbum> ParseAlbums(string json)
    {
        var res = new List<MusicAlbum>();
        using var doc = Open(json);
        if (doc is null) return res;
        var seen = new HashSet<string>();
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "musicResponsiveListItemRenderer") return false;
            if (v.ValueKind != JsonValueKind.Object || BrowseIdOf(v) is not { } id || !id.StartsWith("MPRE", StringComparison.Ordinal) || !seen.Add(id)) return true;
            if (!v.TryGetProperty("flexColumns", out var cols) || cols.ValueKind != JsonValueKind.Array) return true;
            var title = Runs(cols, 0).FirstOrDefault()?.Trim() ?? "";
            var parts = Runs(cols, 1).Select(t => t.Trim()).Where(t => !IsDot(t)).ToList();   // «Álbum • Artista • 2022»
            if (title.Length == 0) { seen.Remove(id); return true; }
            var year = parts.FirstOrDefault(t => Year().IsMatch(t)) ?? "";
            var artist = parts.Count > 1 && parts[1] != year ? parts[1] : "";
            res.Add(new MusicAlbum(id, title, parts.Count > 0 ? parts[0] : "Álbum", artist, year, RowArt(v)));
            return true;
        });
        return res;
    }

    /// <summary>Búsqueda con el filtro «Artistas».</summary>
    public static List<MusicArtist> ParseArtists(string json)
    {
        var res = new List<MusicArtist>();
        using var doc = Open(json);
        if (doc is null) return res;
        var seen = new HashSet<string>();
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "musicResponsiveListItemRenderer") return false;
            if (v.ValueKind != JsonValueKind.Object || BrowseIdOf(v) is not { } id || !id.StartsWith("UC", StringComparison.Ordinal) || !seen.Add(id)) return true;
            var name = v.TryGetProperty("flexColumns", out var cols) && cols.ValueKind == JsonValueKind.Array ? Runs(cols, 0).FirstOrDefault()?.Trim() ?? "" : "";
            if (name.Length == 0) { seen.Remove(id); return true; }
            res.Add(new MusicArtist(id, name, RowArt(v)));
            return true;
        });
        return res;
    }

    /// <summary>
    /// Filas de canciones de un álbum, de la lista «todas las canciones» de un artista o de una lista. El artista, el álbum y la carátula
    /// del contexto rellenan lo que la fila no trae (en un álbum todas las canciones comparten portada y a veces no dicen el artista).
    /// </summary>
    public static List<YouTubeVideo> ParseTracks(string json, string artist = "", string album = "", string? art = null)
    {
        var res = new List<YouTubeVideo>();
        using var doc = Open(json);
        if (doc is null) return res;
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "musicResponsiveListItemRenderer") return false;
            if (ReadTrack(v, artist, album, art) is { } t && res.All(x => x.Id != t.Id)) res.Add(t);
            return true;
        });
        return res;
    }

    private static YouTubeVideo? ReadTrack(JsonElement v, string ctxArtist, string ctxAlbum, string? ctxArt)
    {
        if (v.ValueKind != JsonValueKind.Object || !v.TryGetProperty("flexColumns", out var cols) || cols.ValueKind != JsonValueKind.Array || cols.GetArrayLength() == 0) return null;
        string? id = v.TryGetProperty("playlistItemData", out var pd) && pd.TryGetProperty("videoId", out var vid) ? vid.GetString() : null;
        if (id is null && v.TryGetProperty("overlay", out var ov) && ov.TryGetProperty("musicItemThumbnailOverlayRenderer", out var o2)
            && o2.TryGetProperty("content", out var c) && c.TryGetProperty("musicPlayButtonRenderer", out var pb)
            && pb.TryGetProperty("playNavigationEndpoint", out var pn) && pn.TryGetProperty("watchEndpoint", out var we) && we.TryGetProperty("videoId", out var wid))
            id = wid.GetString();
        if (!YouTubeSearch.IsValidId(id)) return null;

        var title = Runs(cols, 0).FirstOrDefault()?.Trim() ?? "";
        if (title.Length == 0) return null;
        var parts = Runs(cols, 1).Select(t => t.Trim()).Where(t => !IsDot(t)).ToList();

        double duration = 0;
        if (v.TryGetProperty("fixedColumns", out var fixedCols) && fixedCols.ValueKind == JsonValueKind.Array && fixedCols.GetArrayLength() > 0
            && fixedCols[0].TryGetProperty("musicResponsiveListItemFixedColumnRenderer", out var fr) && fr.TryGetProperty("text", out var ft)
            && ft.TryGetProperty("runs", out var fruns) && fruns.ValueKind == JsonValueKind.Array && fruns.GetArrayLength() > 0
            && fruns[0].TryGetProperty("text", out var fx) && fx.GetString() is { } fs && Duration().IsMatch(fs))
            duration = YouTubeSearch.ParseLength(fs);
        else if (parts.Count > 0 && Duration().IsMatch(parts[^1]))
        {
            duration = YouTubeSearch.ParseLength(parts[^1]);
            parts.RemoveAt(parts.Count - 1);
        }

        // artista: primera parte que no sea un contador de reproducciones; si no hay, el del contexto
        var artist = parts.FirstOrDefault(t => !PlayCount().IsMatch(t)) ?? ctxArtist;
        var album = ctxAlbum.Length > 0 ? ctxAlbum : parts.Count >= 2 && !PlayCount().IsMatch(parts[1]) ? parts[1] : "";
        var channel = album.Length > 0 && artist.Length > 0 ? $"{artist} · {album}" : artist.Length > 0 ? artist : album;
        return new YouTubeVideo(id!, title, channel, duration, null, RowArt(v) ?? ctxArt);
    }

    [GeneratedRegex(@"reproducciones|plays|views|visualizaciones", RegexOptions.IgnoreCase)]
    private static partial Regex PlayCount();

    /// <summary>
    /// Página de un artista → canciones más escuchadas, la lista de «todas las canciones» y los discos de los carruseles
    /// (álbumes, sencillos y EP; el tipo se lee del subtítulo, no del título del carrusel, que cambia de idioma).
    /// </summary>
    public static MusicArtistPage ParseArtistPage(string json, string artist = "")
    {
        var page = new MusicArtistPage([], "", []);
        using var doc = Open(json);
        if (doc is null) return page;
        var seen = new HashSet<string>();
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k == "musicShelfRenderer")
            {
                if (page.AllSongsId.Length == 0 && v.ValueKind == JsonValueKind.Object && v.TryGetProperty("bottomEndpoint", out var bo)
                    && bo.TryGetProperty("browseEndpoint", out var be) && be.TryGetProperty("browseId", out var bid)
                    && bid.GetString() is { } vl && vl.StartsWith("VL", StringComparison.Ordinal))
                    page = page with { AllSongsId = vl };
                if (page.Songs.Count == 0) page = page with { Songs = ParseTracksFromNode(v, artist) };
                return true;
            }
            if (k != "musicTwoRowItemRenderer") return false;
            if (v.ValueKind != JsonValueKind.Object || BrowseIdOf(v) is not { } id || !id.StartsWith("MPRE", StringComparison.Ordinal) || !seen.Add(id)) return true;
            var title = v.TryGetProperty("title", out var t) && t.TryGetProperty("runs", out var tr) && tr.ValueKind == JsonValueKind.Array && tr.GetArrayLength() > 0
                && tr[0].TryGetProperty("text", out var tx) ? tx.GetString()?.Trim() ?? "" : "";
            if (title.Length == 0) { seen.Remove(id); return true; }
            var sub = v.TryGetProperty("subtitle", out var s) && s.TryGetProperty("runs", out var sr) && sr.ValueKind == JsonValueKind.Array
                ? sr.EnumerateArray().Select(x => x.TryGetProperty("text", out var xt) ? xt.GetString()?.Trim() ?? "" : "").Where(x => !IsDot(x)).ToList() : [];
            string? art = v.TryGetProperty("thumbnailRenderer", out var tr2) && tr2.TryGetProperty("musicThumbnailRenderer", out var mt)
                && mt.TryGetProperty("thumbnail", out var t3) && t3.TryGetProperty("thumbnails", out var thumbs) ? ThumbUrl(thumbs) : null;
            page.Releases.Add(new MusicAlbum(id, title, sub.FirstOrDefault(x => !Year().IsMatch(x)) ?? "Álbum", artist, sub.FirstOrDefault(x => Year().IsMatch(x)) ?? "", art));
            return true;
        });
        return page;
    }

    private static List<YouTubeVideo> ParseTracksFromNode(JsonElement node, string artist)
    {
        var res = new List<YouTubeVideo>();
        WalkNodes(node, (k, v) =>
        {
            if (k != "musicResponsiveListItemRenderer") return false;
            if (ReadTrack(v, artist, "", null) is { } t && res.All(x => x.Id != t.Id)) res.Add(t);
            return true;
        });
        return res;
    }

    /// <summary>De varios álbumes encontrados, el que mejor encaja con título (y artista): igual, si no contiene; null si ninguno encaja.</summary>
    public static MusicAlbum? PickAlbum(IEnumerable<MusicAlbum> albums, string title, string artist = "")
    {
        var want = MetadataMatcher.Fold(title);
        var who = MetadataMatcher.Fold(artist);
        bool Ok(MusicAlbum a)
        {
            if (who.Length == 0 || a.Artist.Length == 0) return true;
            var n = MetadataMatcher.Fold(a.Artist);
            return n.Contains(who, StringComparison.Ordinal) || who.Contains(n, StringComparison.Ordinal);
        }
        var list = albums.Where(Ok).ToList();
        return list.FirstOrDefault(a => MetadataMatcher.Fold(a.Title) == want)
            ?? list.FirstOrDefault(a => { var n = MetadataMatcher.Fold(a.Title); return n.Length > 0 && (n.Contains(want, StringComparison.Ordinal) || want.Contains(n, StringComparison.Ordinal)); });
    }
}
