using System.Text.Json;

namespace LibreStream.Core;

/// <summary>Una escucha: la canción (lo mismo que se guarda en la biblioteca), su artista y cuándo sonó.</summary>
public sealed record PlayRecord(SavedItem Item, string Artist, DateTime PlayedAt);

/// <summary>Una mezcla de «Hecho para ti»: por una canción («Porque escuchaste…») o por un artista («Mezcla de…»).</summary>
public sealed record MixSeed(string Kind, string Title, string Artist, SavedItem Seed);

/// <summary>
/// Historial de escucha, solo en este PC (history.json): para «Seguir escuchando» y las mezclas de Inicio. No sale del equipo.
/// Cuenta como escucha una canción que ha sonado al menos 30 s (o la mitad, si es más corta).
/// </summary>
public sealed class ListenHistory
{
    public const int Max = 1000;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string? _file;
    private readonly List<PlayRecord> _entries;
    private readonly int _max;

    public ListenHistory(string? dir, int max = Max)
    {
        _max = max;
        if (dir is null) { _entries = []; return; }
        Directory.CreateDirectory(dir);
        _file = Path.Combine(dir, "history.json");
        try
        {
            _entries = File.Exists(_file) ? JsonSerializer.Deserialize<List<PlayRecord>>(File.ReadAllText(_file), Json) ?? [] : [];
            _entries.RemoveAll(e => e?.Item is null);
        }
        catch (Exception e) when (e is JsonException or IOException) { _entries = []; }
    }

    /// <summary>De la más reciente a la más antigua.</summary>
    public IReadOnlyList<PlayRecord> Entries => _entries;

    /// <summary>Segundos que tiene que sonar una canción para contar como escuchada.</summary>
    public static double CountsAfter(double durationSec) => durationSec > 0 ? Math.Min(30, durationSec / 2) : 30;

    public void Add(PlayRecord record)
    {
        _entries.Insert(0, record);
        if (_entries.Count > _max) _entries.RemoveRange(_max, _entries.Count - _max);
        if (_file is null) return;
        try { File.WriteAllText(_file, JsonSerializer.Serialize(_entries, Json)); } catch (IOException) { /* se guarda en la siguiente */ }
    }

    private static string Key(SavedItem i) => $"{i.Source}:{i.Id}";

    /// <summary>«Seguir escuchando»: lo último que sonó, sin repetir.</summary>
    public static List<SavedItem> RecentDistinct(IEnumerable<PlayRecord> entries, int n)
        => entries.DistinctBy(e => Key(e.Item)).Take(n).Select(e => e.Item).ToList();

    /// <summary>Artistas más escuchados desde <paramref name="since"/> (nombre tal cual se ve, nº de escuchas), de más a menos.</summary>
    public static List<(string Artist, int Plays)> TopArtists(IEnumerable<PlayRecord> entries, DateTime since, int n)
        => entries.Where(e => e.PlayedAt >= since && MetadataMatcher.Fold(e.Artist).Length > 0)
            .GroupBy(e => MetadataMatcher.Fold(e.Artist))
            .Select(g => (Artist: g.First().Artist, Plays: g.Count(), Last: g.Max(x => x.PlayedAt)))
            .OrderByDescending(x => x.Plays).ThenByDescending(x => x.Last)
            .Take(n).Select(x => (x.Artist, x.Plays)).ToList();

    /// <summary>
    /// Mezclas de «Hecho para ti» (como mucho 4): una por cada artista que has escuchado al menos 2 veces en los últimos 30 días
    /// (hasta 2) y «Porque escuchaste…» con las últimas canciones de otros artistas. La semilla es la canción más escuchada del artista.
    /// </summary>
    public static List<MixSeed> Mixes(IReadOnlyList<PlayRecord> entries, DateTime now)
    {
        var res = new List<MixSeed>();
        var recent = entries.Where(e => e.PlayedAt >= now.AddDays(-30)).ToList();
        var used = new HashSet<string>();
        foreach (var (artist, plays) in TopArtists(recent, DateTime.MinValue, 2))
        {
            if (plays < 2) break;
            var folded = MetadataMatcher.Fold(artist);
            var seed = recent.Where(e => MetadataMatcher.Fold(e.Artist) == folded)
                .GroupBy(e => Key(e.Item)).OrderByDescending(g => g.Count()).First().First().Item;
            res.Add(new MixSeed("artist", $"Mezcla de {artist}", artist, seed));
            used.Add(folded);
        }
        foreach (var e in entries.DistinctBy(e => Key(e.Item)))
        {
            if (res.Count >= 4) break;
            var folded = MetadataMatcher.Fold(e.Artist);
            if (!used.Add(folded.Length > 0 ? folded : Key(e.Item))) continue;
            res.Add(new MixSeed("because", $"Porque escuchaste «{e.Item.Title}»", e.Artist, e.Item));
            if (res.Count(m => m.Kind == "because") >= 2) break;
        }
        return res;
    }

    /// <summary>Mezcla varias listas alternándolas (A1, B1, A2, B2…), sin repetir ni incluir <paramref name="exclude"/>.</summary>
    public static List<T> Interleave<T>(IReadOnlyList<IReadOnlyList<T>> lists, Func<T, string> key, IEnumerable<string> exclude, int max)
    {
        var seen = new HashSet<string>(exclude);
        var res = new List<T>();
        for (var i = 0; res.Count < max && lists.Any(l => i < l.Count); i++)
            foreach (var l in lists)
                if (i < l.Count && res.Count < max && seen.Add(key(l[i]))) res.Add(l[i]);
        return res;
    }
}
