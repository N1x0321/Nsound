namespace LibreStream.Core;

/// <summary>Un artista del resumen: cuántas veces sonó y su canción más escuchada (para la foto y para reproducir).</summary>
public sealed record ArtistPlays(string Artist, int Plays, SavedItem TopSong);

/// <summary>Una canción del resumen y cuántas veces sonó.</summary>
public sealed record SongPlays(SavedItem Song, string Artist, int Plays);

/// <summary>
/// «Tu semana»: lo escuchado en los últimos 7 días (hoy incluido), calculado solo con el historial de este PC.
/// Los minutos son aproximados: cada escucha suma la duración de la canción (como mucho 10 min por escucha).
/// </summary>
public sealed record WeekSummary(
    DateTime From, double Minutes, int Plays, int Songs, int Artists,
    IReadOnlyList<ArtistPlays> TopArtists, IReadOnlyList<SongPlays> TopSongs,
    IReadOnlyList<double> MinutesByDay, IReadOnlyList<DateTime> Days, double PreviousMinutes)
{
    public bool IsEmpty => Plays == 0;

    /// <summary>Cambio frente a los 7 días anteriores (0,25 = +25 %); null si antes no hubo nada con qué comparar.</summary>
    public double? Change => PreviousMinutes >= 1 ? Minutes / PreviousMinutes - 1 : null;

    private static double MinutesOf(PlayRecord r) => Math.Clamp(r.Item.DurationSec, 0, 600) / 60.0;

    public static WeekSummary Build(IEnumerable<PlayRecord> entries, DateTime now, int top = 5)
    {
        var from = now.Date.AddDays(-6);
        var all = entries.ToList();
        var week = all.Where(e => e.PlayedAt >= from && e.PlayedAt <= now).ToList();
        var previous = all.Where(e => e.PlayedAt >= from.AddDays(-7) && e.PlayedAt < from).Sum(MinutesOf);
        var days = Enumerable.Range(0, 7).Select(i => from.AddDays(i)).ToList();
        var byDay = days.Select(d => week.Where(e => e.PlayedAt.Date == d).Sum(MinutesOf)).ToList();

        static string SongKey(PlayRecord e) => $"{e.Item.Source}:{e.Item.Id}";
        var songs = week.GroupBy(SongKey)
            .Select(g => new SongPlays(g.First().Item, g.First().Artist, g.Count()))
            .OrderByDescending(s => s.Plays).ThenBy(s => week.FindIndex(e => SongKey(e) == $"{s.Song.Source}:{s.Song.Id}"))
            .ToList();
        var artists = week.Where(e => MetadataMatcher.Fold(e.Artist).Length > 0)
            .GroupBy(e => MetadataMatcher.Fold(e.Artist))
            .Select(g => new ArtistPlays(g.First().Artist, g.Count(),
                g.GroupBy(SongKey).OrderByDescending(x => x.Count()).First().First().Item))
            .OrderByDescending(a => a.Plays).ThenBy(a => a.Artist, StringComparer.CurrentCulture)
            .ToList();

        return new WeekSummary(from, week.Sum(MinutesOf), week.Count, songs.Count, artists.Count,
            artists.Take(top).ToList(), songs.Take(top).ToList(), byDay, days, previous);
    }
}
