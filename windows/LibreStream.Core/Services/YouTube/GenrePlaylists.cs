using System.Text.Json;

namespace LibreStream.Core;

/// <summary>Una categoría de «Moods y géneros» de YouTube Music («Dance y electrónica», «Latina»…) y el parámetro para abrirla.</summary>
public sealed record MoodCategory(string Name, string Params);

/// <summary>
/// Géneros siempre al día: en vez de una búsqueda suelta (que devuelve mezclas viejas o lo que sea), cada género usa una lista oficial de
/// YouTube Music de su categoría de «Moods y géneros» («Éxitos actuales del dance», «Hot Reggaeton»…). Esas listas las renueva YouTube
/// cada semana, así que lo que se ve es lo de ahora. Solo se leen metadatos públicos.
/// </summary>
public static partial class YouTubeMusic
{
    public const string MoodsBrowseId = "FEmusic_moods_and_genres";
    public const string MoodCategoryBrowseId = "FEmusic_moods_and_genres_category";

    /// <summary>Petición de una página con parámetros (las categorías de «Moods y géneros»).</summary>
    public static string BrowseBody(string browseId, string? country, string? @params)
    {
        var body = new Dictionary<string, object> { ["context"] = Context, ["browseId"] = browseId };
        if (!string.IsNullOrEmpty(@params)) body["params"] = @params;
        if (country is not null && CountryCode().IsMatch(country)) body["formData"] = new { selectedValues = new[] { country } };
        return JsonSerializer.Serialize(body);
    }

    /// <summary>Categoría de «Moods y géneros» de cada género de la app, y palabras para elegir la lista (de mejor a peor).</summary>
    public static (string Category, string[] Prefer)? GenreSource(string genre) => genre switch
    {
        "Reggaetón" => ("Latina", ["hot reggaet", "reggaet", "perreo", "dembow"]),
        "Latino" => ("Latina", ["latin now", "éxitos latinos", "latin", "latino"]),
        "Pop" => ("Pop", ["pop hotlist", "pop certified", "hotlist", "pop"]),
        "Rock" => ("Rock", ["today's rock hits", "rock hits", "hotlist", "rock"]),
        "Electrónica" => ("Dance y electrónica", ["actuales del dance", "dance hits", "house + techno", "dance", "edm"]),
        "Hip hop" => ("Hip hop", ["actuales de hiphop", "actuales de hip hop", "rap bangers", "hip hop", "rap"]),
        "Lo-fi" => ("Concentración", ["lo-fi", "lofi"]),
        _ => null,
    };

    /// <summary>Página de «Moods y géneros» → categorías con su parámetro.</summary>
    public static List<MoodCategory> ParseMoodCategories(string json)
    {
        var res = new List<MoodCategory>();
        using var doc = Open(json);
        if (doc is null) return res;
        WalkNodes(doc.RootElement, (k, v) =>
        {
            if (k != "musicNavigationButtonRenderer") return false;
            var name = v.TryGetProperty("buttonText", out var bt) && bt.TryGetProperty("runs", out var r) && r.ValueKind == JsonValueKind.Array
                ? string.Concat(r.EnumerateArray().Select(x => x.TryGetProperty("text", out var t) ? t.GetString() : "")).Trim() : "";
            if (name.Length > 0 && v.TryGetProperty("clickCommand", out var cc) && cc.TryGetProperty("browseEndpoint", out var be)
                && be.TryGetProperty("browseId", out var id) && id.GetString() == MoodCategoryBrowseId
                && be.TryGetProperty("params", out var p) && p.GetString() is { Length: > 0 } ps)
                res.Add(new MoodCategory(name, ps));
            return true;
        });
        return res;
    }

    /// <summary>Categoría por nombre, sin tildes ni mayúsculas («dance y electronica» vale).</summary>
    public static MoodCategory? FindCategory(IEnumerable<MoodCategory> categories, string name)
    {
        var want = MetadataMatcher.Fold(name);
        var list = categories.ToList();
        return list.FirstOrDefault(c => MetadataMatcher.Fold(c.Name) == want)
            ?? list.FirstOrDefault(c => MetadataMatcher.Fold(c.Name).Contains(want, StringComparison.Ordinal));
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"cl[aá]sic|classic|billion|esencial|essential|\b(50|60|70|80|90)s?\b|años? (50|60|70|80|90)|00s|\d0s|de los \d|retro|viej|throwback|instrumental", System.Text.RegularExpressions.RegexOptions.IgnoreCase)]
    private static partial System.Text.RegularExpressions.Regex OldList();

    /// <summary>
    /// De las listas de una categoría, la mejor para el género: solo listas oficiales de YouTube Music (RDCLAK…, se actualizan solas),
    /// la que tenga la primera palabra preferida en el título; nunca las de «clásicos», décadas o instrumentales si hay otra.
    /// </summary>
    public static ChartList? PickGenrePlaylist(IReadOnlyList<ChartList> lists, IReadOnlyList<string> prefer)
    {
        var official = lists.Where(l => l.Id.StartsWith("VLRDCLAK", StringComparison.Ordinal)).ToList();
        var fresh = official.Where(l => !OldList().IsMatch(l.Title)).ToList();
        foreach (var pool in new[] { fresh, official })
        {
            foreach (var word in prefer)
            {
                var w = MetadataMatcher.Fold(word);
                if (pool.FirstOrDefault(l => MetadataMatcher.Fold(l.Title).Contains(w, StringComparison.Ordinal)) is { } hit) return hit;
            }
        }
        return fresh.FirstOrDefault() ?? official.FirstOrDefault();
    }

    /// <summary>
    /// Toque del país: de la lista del género, primero las canciones de los artistas del ranking de tu país (en su orden), luego el resto
    /// en el orden de la lista. Así en Colombia salen antes los artistas que suenan en Colombia, y en España los de España.
    /// </summary>
    public static List<YouTubeVideo> BoostByArtists(IReadOnlyList<YouTubeVideo> songs, IReadOnlyList<string> countryArtists)
    {
        var rank = new Dictionary<string, int>();
        for (var i = 0; i < countryArtists.Count; i++) rank.TryAdd(MetadataMatcher.Fold(countryArtists[i]), i);
        int RankOf(YouTubeVideo v)
        {
            var best = int.MaxValue;
            foreach (var part in v.Channel.Split(" · ")[0].Split([",", " y ", " & ", " x ", " X "], StringSplitOptions.RemoveEmptyEntries))
                if (rank.TryGetValue(MetadataMatcher.Fold(part), out var r)) best = Math.Min(best, r);
            return best;
        }
        return songs.Select((v, i) => (v, i, r: RankOf(v))).OrderBy(x => x.r == int.MaxValue ? 1 : 0).ThenBy(x => x.r == int.MaxValue ? x.i : x.r).ThenBy(x => x.i).Select(x => x.v).ToList();
    }

    /// <summary>Canciones actuales de un género (lista oficial de su categoría) y el nombre de esa lista; vacío si no se encuentra.</summary>
    public static async Task<(List<YouTubeVideo> Songs, string ListTitle)> GenreSongsAsync(HttpClient http, string genre, CancellationToken ct = default)
    {
        if (GenreSource(genre) is not { } src) return ([], "");
        var categories = ParseMoodCategories(await PostAsync(http, BrowseUrl, BrowseBody(MoodsBrowseId), ct));
        if (FindCategory(categories, src.Category) is not { } cat) return ([], "");
        var lists = ParseChartLists(await PostAsync(http, BrowseUrl, BrowseBody(MoodCategoryBrowseId, null, cat.Params), ct));
        if (PickGenrePlaylist(lists, src.Prefer) is not { } pick) return ([], "");
        return (await BrowseTracksAsync(http, pick.Id, ct: ct), pick.Title);
    }
}
