using System.Text.Json;
using System.Text.RegularExpressions;

namespace LibreStream.Core;

/// <summary>Una lista de éxitos oficial de YouTube Music (Id = «VL…»).</summary>
public sealed record ChartList(string Id, string Title);

/// <summary>Una búsqueda de estantería; <c>Week</c> = solo lo publicado esta semana (se renueva sola).</summary>
public sealed record ShelfQuery(string Q, bool Week = false);

/// <summary>Estantería de «Vídeos» adaptada al país.</summary>
public sealed record CountryShelf(string Title, List<ShelfQuery> Queries);

/// <summary>Éxitos y artistas por país: listas de la página de listas de YouTube Music (solo metadatos públicos). Puerto de <c>00-core.js</c>.</summary>
public static partial class YouTubeMusic
{
    /// <summary>Página de listas de éxitos de YouTube Music («Artistas principales»): se actualiza sola.</summary>
    public const string ChartsBrowseId = "FEmusic_charts";

    private static readonly Dictionary<string, string> Countries = new()
    {
        ["ES"] = "España", ["MX"] = "México", ["AR"] = "Argentina", ["CO"] = "Colombia", ["CL"] = "Chile", ["PE"] = "Perú", ["VE"] = "Venezuela",
        ["EC"] = "Ecuador", ["UY"] = "Uruguay", ["PY"] = "Paraguay", ["BO"] = "Bolivia", ["DO"] = "República Dominicana", ["PR"] = "Puerto Rico",
        ["CR"] = "Costa Rica", ["PA"] = "Panamá", ["GT"] = "Guatemala", ["SV"] = "El Salvador", ["HN"] = "Honduras", ["NI"] = "Nicaragua",
        ["CU"] = "Cuba", ["US"] = "Estados Unidos", ["BR"] = "Brasil", ["PT"] = "Portugal", ["FR"] = "Francia", ["IT"] = "Italia",
        ["DE"] = "Alemania", ["GB"] = "Reino Unido", ["CA"] = "Canadá",
    };

    /// <summary>Nombre del país en español («CO» → «Colombia»); si no se conoce, el propio código.</summary>
    public static string CountryName(string? cc)
        => Countries.TryGetValue((cc ?? "").ToUpperInvariant(), out var name) ? name : cc ?? "";

    /// <summary>País del usuario («ES», «MX»…) por el idioma/región del sistema («es-MX»); si no se sabe, España.</summary>
    public static string UserCountry(IEnumerable<string?>? langs)
    {
        foreach (var l in langs ?? [])
        {
            var m = LangRegion().Match(l ?? "");
            if (m.Success) return m.Groups[1].Value.ToUpperInvariant();
        }
        return "ES";
    }

    [GeneratedRegex(@"[-_]([A-Za-z]{2})$")]
    private static partial Regex LangRegion();

    private static string? CardArt(JsonElement v)
        => v.TryGetProperty("thumbnailRenderer", out var tr) && tr.TryGetProperty("musicThumbnailRenderer", out var mt)
           && mt.TryGetProperty("thumbnail", out var t3) && t3.TryGetProperty("thumbnails", out var thumbs) ? ThumbUrl(thumbs) : null;

    private static string[] TwoRowTitleRuns(JsonElement v)
        => v.TryGetProperty("title", out var t) && t.TryGetProperty("runs", out var r) && r.ValueKind == JsonValueKind.Array
            ? r.EnumerateArray().Select(x => x.TryGetProperty("text", out var tx) ? tx.GetString() ?? "" : "").ToArray() : [];

    /// <summary>Respuesta de las listas de éxitos → artistas del ranking en el orden del ranking, sin repetir.</summary>
    public static List<MusicArtist> ParseChartArtists(string json)
    {
        var res = new List<MusicArtist>();
        using var doc = Open(json);
        if (doc is null) return res;
        var seen = new HashSet<string>();
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k is not ("musicResponsiveListItemRenderer" or "musicTwoRowItemRenderer")) return false;
            if (v.ValueKind != JsonValueKind.Object || BrowseIdOf(v) is not { } id || !id.StartsWith("UC", StringComparison.Ordinal) || seen.Contains(id)) return true;
            var name = k == "musicTwoRowItemRenderer"
                ? TwoRowTitleRuns(v).FirstOrDefault()?.Trim() ?? ""
                : v.TryGetProperty("flexColumns", out var cols) && cols.ValueKind == JsonValueKind.Array ? Runs(cols, 0).FirstOrDefault()?.Trim() ?? "" : "";
            if (name.Length == 0) return true;
            seen.Add(id);
            res.Add(new MusicArtist(id, name, k == "musicTwoRowItemRenderer" ? CardArt(v) : RowArt(v) ?? CardArt(v)));
            return true;
        });
        return res;
    }

    /// <summary>Listas de éxitos oficiales del país (en la página de listas de YouTube Music).</summary>
    public static List<ChartList> ParseChartLists(string json)
    {
        var res = new List<ChartList>();
        using var doc = Open(json);
        if (doc is null) return res;
        var seen = new HashSet<string>();
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "musicTwoRowItemRenderer") return false;
            if (v.ValueKind != JsonValueKind.Object || BrowseIdOf(v) is not { } id || !id.StartsWith("VL", StringComparison.Ordinal) || !seen.Add(id)) return true;
            res.Add(new ChartList(id, string.Concat(TwoRowTitleRuns(v)).Trim()));
            return true;
        });
        return res;
    }

    /// <summary>De las listas de éxitos, la mejor para «Éxitos»: los 100 más populares, si no el top diario, si no las tendencias.</summary>
    public static ChartList? PickHitsList(IReadOnlyList<ChartList>? lists)
    {
        var l = lists ?? [];
        return l.FirstOrDefault(x => PopularTitle().IsMatch(x.Title))
            ?? l.FirstOrDefault(x => DailyTitle().IsMatch(x.Title))
            ?? l.FirstOrDefault(x => TrendTitle().IsMatch(x.Title))
            ?? l.FirstOrDefault();
    }

    [GeneratedRegex(@"100|m[aá]s populares|most popular", RegexOptions.IgnoreCase)]
    private static partial Regex PopularTitle();
    [GeneratedRegex(@"top diario|daily", RegexOptions.IgnoreCase)]
    private static partial Regex DailyTitle();
    [GeneratedRegex(@"tendencias|trending", RegexOptions.IgnoreCase)]
    private static partial Regex TrendTitle();

    /// <summary>Artistas del ranking del país (con el de España de respaldo si el país no tiene ranking).</summary>
    public static async Task<List<MusicArtist>> ChartArtistsAsync(HttpClient http, string country, CancellationToken ct = default)
    {
        var list = ParseChartArtists(await PostAsync(http, BrowseUrl, BrowseBody(ChartsBrowseId, country), ct));
        if (list.Count < 6 && country != "ES") list = ParseChartArtists(await PostAsync(http, BrowseUrl, BrowseBody(ChartsBrowseId, "ES"), ct));
        return list;
    }

    /// <summary>Canciones de la lista oficial de éxitos del país («Los 100 vídeos musicales más populares en …»); vacío si no hay lista.</summary>
    public static async Task<List<YouTubeVideo>> CountryHitsAsync(HttpClient http, string country, CancellationToken ct = default)
    {
        var lists = ParseChartLists(await PostAsync(http, BrowseUrl, BrowseBody(ChartsBrowseId, country), ct));
        return PickHitsList(lists) is { } pick ? await BrowseTracksAsync(http, pick.Id, ct: ct) : [];
    }

    private static List<ShelfQuery> Qs(params (string q, bool week)[] x) => x.Select(t => new ShelfQuery(t.q, t.week)).ToList();

    /// <summary>Estanterías de «Vídeos» según el país: lo de esta semana se pide con el filtro «esta semana», así que se renueva solo.</summary>
    public static List<CountryShelf> ShelvesFor(string cc, string? countryName)
    {
        var n = countryName ?? "";
        var es = string.Equals(cc, "ES", StringComparison.OrdinalIgnoreCase);
        return
        [
            new(n.Length > 0 ? "Novedades en " + n : "Novedades", Qs(("vídeos nuevos " + n, true), ("lo más visto hoy " + n, true))),
            new("Videoclips nuevos", Qs(("videoclip oficial nuevo " + n, true), ("estreno video oficial " + n, true))),
            new("Series y tráilers", Qs(("tráiler oficial serie estreno", true), ("tráiler oficial película estreno", true))),
            new(es ? "Eventos del año" : "Eventos y conciertos", es ? Qs(("La Velada del Año", false), ("Kings League resumen", false)) : Qs(("evento en vivo resumen " + n, false), ("concierto completo " + n, false))),
            new("YouTubers", es ? Qs(("Ibai", false), ("AuronPlay", false), ("TheGrefg", false)) : Qs(("youtubers " + n + " vídeo nuevo", true), ("reto youtuber " + n, false))),
            new("Deporte", Qs(("resumen partido goles " + n, true))),
            new("Documentales", Qs(("documental completo en español " + n, false))),
            new("Humor y entretenimiento", Qs(("humor " + n + " vídeo", true), ("programa entretenimiento " + n, false))),
        ];
    }
}
